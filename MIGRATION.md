# Migration Plan — Emergent (here) → Client Server

Goal: move the running **Story At Home · Marketplace AutoPilot** app and its data from this Emergent preview/deploy to the client's own server, with zero data loss and a clean cutover + rollback path.

Read `SELF_HOSTING.md` first for specs, software, and config. This file is the **ordered runbook**.

> Current state note: the app is **clean-seeded** — `sales`, `settlement`, `calculations`, `discrepancies` and contract masters are empty; only 2 users + config singletons (tax/tolerance/settlement) exist. If you migrate **before** real ingestion, data migration (Phase 3) is trivial. If you migrate **after** the client has uploaded data, Phase 3 moves it faithfully.

---

## Phase 0 — Prerequisites & inventory
- [ ] Target server provisioned per `SELF_HOSTING.md` §3 (OS, Python 3.11, Node 20, Yarn, MongoDB 7, Nginx).
- [ ] DNS control for the chosen hostname (e.g. `autopilot.storyathome.com`).
- [ ] Decide AI Insights mode (keep `EMERGENT_LLM_KEY` vs. rule-based fallback) — `SELF_HOSTING.md` §7.
- [ ] Collect the current secrets to carry over (you'll **rotate** `JWT_SECRET` and passwords, see Phase 4).
- [ ] Maintenance window agreed (ingestion/edits paused during cutover).

---

## Phase 1 — Get the code onto the target
Preferred: the repo is on GitHub (`Latin-Marketplace` origin / or the client's fork).
```bash
sudo mkdir -p /opt/sah && cd /opt/sah
git clone <repo-url> .
# layout: /opt/sah/backend, /opt/sah/frontend
```
Alternative: download the code zip from Emergent ("Download code") and unzip into `/opt/sah`.

Do **not** copy `.env`, `node_modules`, `__pycache__`, or `frontend/build` from the source — these are environment-specific and will be regenerated.

Optional: the `lq_data/` folder (~155 MB of reference Myntra data) is **not needed** in production and can be skipped.

---

## Phase 2 — Install dependencies
```bash
# Backend
python3.11 -m venv /opt/sah/venv
/opt/sah/venv/bin/pip install -r /opt/sah/backend/requirements.txt

# Frontend deps (build happens in Phase 5, after env is set)
cd /opt/sah/frontend && yarn install --frozen-lockfile
```

---

## Phase 3 — Data migration (MongoDB)

### 3a. Export from the source (this environment)
Run against the **current** Mongo (here `mongodb://localhost:27017`, DB `test_database`):
```bash
mongodump --uri "mongodb://localhost:27017" --db test_database --out /tmp/sah_dump
tar czf /tmp/sah_dump.tgz -C /tmp/sah_dump .
# transfer /tmp/sah_dump.tgz to the target server (scp/rsync)
```
This captures **all** collections: `users`, `sales`, `settlement`, `calculations`, `discrepancies`, `recon_runs`, `uploads`, `recovery_cases`/`recovery_notes`/`recovery_evidence`, `commission_rules`, `fixed_fees`, `gt_charges`, `return_fees`, `subcat_levels`, `tolerances`, `tax_rates`, `settlement_settings`, `insights_briefs`, `breakage_claims`, and the new **`support_tickets`**, **`weight_discrepancies`**, **`return_orders`**.

### 3b. Restore into the target DB
```bash
mkdir -p /tmp/restore && tar xzf /tmp/sah_dump.tgz -C /tmp/restore
# restore into the PROD db name (can differ from source)
mongorestore --uri "mongodb://sah_user:PASS@127.0.0.1:27017/?authSource=sah_prod" \
  --nsFrom 'test_database.*' --nsTo 'sah_prod.*' /tmp/restore
```

### 3c. Decide what to carry
- **Config-only migration (recommended if no real data yet)**: you can skip the dump entirely — the target app **auto-seeds** admin + marketing + config singletons on first boot. Then the client uploads masters + marketplace data fresh on the new server.
- **Full migration (data already entered)**: use 3a/3b to bring everything.
- Either way, **users** can be re-seeded fresh; if you change `ADMIN_PASSWORD` in the new `.env`, the startup routine re-hashes the admin password to match.

---

## Phase 4 — Configure environment on target

Create `/opt/sah/backend/.env` (perms `chmod 600`):
```env
MONGO_URL="mongodb://sah_user:STRONGPASS@127.0.0.1:27017/sah_prod?authSource=sah_prod"
DB_NAME="sah_prod"
CORS_ORIGINS="https://autopilot.storyathome.com"
JWT_SECRET="<freshly generated 48+ char secret>"
ADMIN_EMAIL="admin@fundle.ai"
ADMIN_PASSWORD="<new strong password>"
MARKETING_EMAIL="marketing@fundle.ai"
MARKETING_PASSWORD="<new strong password>"
EMERGENT_LLM_KEY=""                 # empty => rule-based AI fallback, fully local
CLAIM_EMAIL_TO="seller.support@myntra.com"
CLAIM_FROM_NAME="Story At Home Finance"
```
> **Rotate `JWT_SECRET`** on migration (old tokens become invalid → users simply log in again). Generate: `python3 -c "import secrets;print(secrets.token_urlsafe(48))"`.

Create `/opt/sah/frontend/.env`:
```env
REACT_APP_BACKEND_URL=https://autopilot.storyathome.com
WDS_SOCKET_PORT=443
ENABLE_HEALTH_CHECK=false
```

---

## Phase 5 — Build frontend & start services
```bash
cd /opt/sah/frontend && yarn build        # REACT_APP_BACKEND_URL is baked in here

# backend service (systemd) — see SELF_HOSTING.md §6A
sudo systemctl enable --now sah-backend
curl -s http://127.0.0.1:8001/api/health   # expect {"status":"ok",...}
```
Set up Nginx + TLS per `SELF_HOSTING.md` §6A (or use the Docker Compose path in §6B).

---

## Phase 6 — Validation (pre-cutover, on a test hostname or /etc/hosts override)
- [ ] `GET /api/health` → ok; `GET /api/marketplaces` → Myntra active.
- [ ] Login with the new admin password works; `/api/auth/me` returns the user.
- [ ] All sidebar pages render (Overview, Insights, Reports, P&L, Uploads, SKU Costs, Claims, Sales, Calculations, Reconciliation, Discrepancies, Recovery, **Return Orders, Weight Charges, Seller Support**, Masters, Methodology).
- [ ] Branding reads "Story At Home · Marketplace AutoPilot — Powered by Fundle"; SAH monogram; no "Latin Quarter"/"LQ".
- [ ] If full data migrated: spot-check row counts match source (see Phase 7 checksum).
- [ ] Masters tax/tolerance/settlement editable; (if data) run a reconciliation and confirm Discrepancies populate on Settlement basis.
- [ ] New modules: create a seller-support ticket, log a weight discrepancy + raise ticket, create a return with a problem status and confirm an auto-ticket appears in Seller Support.

### Phase 7 — Row-count checksum (optional, for full migration)
On both source and target:
```bash
mongosh --quiet --eval '
for (const c of db.getCollectionNames().sort())
  print(c.padEnd(24), db[c].countDocuments({}));'
```
Compare the two outputs; they should match.

---

## Phase 8 — Cutover
1. Freeze the source: stop ingestion/edits (announce maintenance).
2. If data changed since the first dump, re-run a quick **delta dump/restore** (Phase 3) during the window (fast; collections are small unless heavy ingest happened).
3. Point DNS `autopilot.storyathome.com` → target server IP (lower TTL beforehand, e.g. 300s).
4. Confirm TLS cert is live (`certbot`), then run the Phase 6 checklist against the **real** domain.
5. Announce go-live.

---

## Phase 9 — Rollback plan
- Keep the Emergent deployment **running and unchanged** until the client signs off (don't delete it).
- If a blocker appears post-cutover: revert DNS back to the Emergent URL (TTL-bounded) — the old app + its data are intact.
- Because `JWT_SECRET` differs between environments, users just re-login after any switch; no data corruption risk.
- Keep the migration dump (`sah_dump.tgz`) archived for at least 30 days.

---

## Post-migration hardening (once stable)
- [ ] Remove/disable the Emergent deployment after sign-off.
- [ ] Enable nightly `mongodump` backups + off-box retention.
- [ ] Add the app to the client's monitoring (`/api/health`).
- [ ] Rotate seeded user passwords from the Masters/admin flow; create per-user accounts via `POST /api/auth/register` (admin-only) instead of sharing the seed logins.
- [ ] If they want self-owned AI Insights, plan the `routers/insights.py` swap to a direct Anthropic/OpenAI key.

---

## What changes between environments (cheat-sheet)
| Thing | Here (Emergent) | Client server |
|------|------------------|----------------|
| Backend URL | `*.preview.emergentagent.com` | their domain (rebuild frontend!) |
| Mongo | local, no auth, `test_database` | authed, private, `sah_prod` |
| Process mgr | supervisor (platform) | systemd / docker-compose |
| TLS / routing | platform ingress | Nginx + certbot |
| `JWT_SECRET` | platform value | **rotate to new** |
| Seeded passwords | defaults | **change to strong** |
| AI key | `EMERGENT_LLM_KEY` | keep, or empty for local fallback |
