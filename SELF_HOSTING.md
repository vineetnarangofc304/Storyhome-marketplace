# Self-Hosting Guide — Story At Home · Marketplace AutoPilot (Fundle)

This app is a 3-tier stack: **React (static build)** + **FastAPI (Python)** + **MongoDB**.
Everything below is what a client needs to run it fully on their own server(s).

---

## 1. Architecture (what actually runs)

```
                      ┌──────────────────────────────────────┐
  Browser  ──HTTPS──▶ │  Nginx (reverse proxy + static files)  │
                      │   /           -> React build (static)  │
                      │   /api/*      -> FastAPI :8001          │
                      └───────────────┬────────────────────────┘
                                      │ (localhost)
                         ┌────────────▼─────────────┐
                         │  FastAPI (uvicorn) :8001  │  (102 /api routes)
                         └────────────┬─────────────┘
                                      │ (TCP 27017)
                         ┌────────────▼─────────────┐
                         │        MongoDB 7.0        │
                         └───────────────────────────┘
```

- Backend binds `0.0.0.0:8001`, every route is prefixed `/api` (so Nginx routes cleanly).
- Frontend is a **static build** (CRA + craco). `REACT_APP_BACKEND_URL` is **baked in at build time** — it must be set before `yarn build`.
- Auth = JWT (bcrypt password hashing). Token is returned to the browser and sent as `Authorization: Bearer`. (A cookie is also set but the Bearer token is the primary mechanism.)
- The backend seeds the admin + marketing users and the config singletons (tax/tolerance/settlement) on first startup — idempotent, safe to run on every boot and with multiple workers.

---

## 2. Software prerequisites (exact versions we run)

| Component   | Version we run        | Notes |
|-------------|-----------------------|-------|
| OS          | Debian 12 / Ubuntu 22.04 LTS (x86-64 or ARM64) | Any modern Linux works |
| Python      | **3.11.x**            | 3.11 required (tested on 3.11.16) |
| Node.js     | **20.x** (20.20.2)    | Build-time only; not needed at runtime |
| Yarn        | **1.22.x** (classic)  | Use yarn, **not npm** |
| MongoDB     | **7.0.x**             | 6.0+ is fine |
| Nginx       | 1.22+                 | Reverse proxy + TLS + static hosting |
| Process mgr | systemd (native) **or** Docker + docker-compose | Either approach documented below |
| TLS         | certbot / Let's Encrypt (or client's own certs) | |

**Optional OS packages** (only needed if you extract archived raw marketplace dumps *on the server*, e.g. `.rar`/`.7z`; normal `.xlsx`/`.csv` uploads via the UI do **not** need these):
```
p7zip-full, unar
```

---

## 3. Server specifications (sizing)

Workload = an internal ops/finance dashboard (handful of concurrent users). The heavy part is **reconciliation**, which can load a large batch of sales/settlement rows into memory per run. Size RAM to the monthly row volume.

### Tier A — Pilot / single marketplace (Myntra only, < ~150k rows/month)
- **App + DB on one box**
- 2 vCPU · **4 GB RAM** · 40 GB SSD
- Fine for evaluation and low volume.

### Tier B — Recommended production (multi-marketplace, ~150k–1M rows/month)
- **App host**: 4 vCPU · **8 GB RAM** · 40 GB SSD
- **DB host (separate)**: 4 vCPU · **16 GB RAM** · 100 GB SSD (NVMe preferred)
- Separating DB lets reconciliation memory spikes not compete with Mongo's working set.

### Tier C — Heavy (several marketplaces, >1M rows/month, frequent re-ingests)
- **App host**: 8 vCPU · **16 GB RAM**
- **DB host**: 8 vCPU · **32 GB RAM** · 250 GB+ NVMe, daily backups
- Consider MongoDB replica set (3 nodes) for HA.

**Disk notes**: the app code is tiny (~1.5 MB). Uploaded Excel files are parsed into Mongo and not retained on disk. Plan DB disk for ~1–3 KB per sales/settlement row plus indexes (budget generously). Keep ≥ 30% free for Mongo.

**Network**: outbound HTTPS (443) needed only if AI Insights calls an external LLM (see §7). Otherwise the app is fully self-contained.

---

## 4. Environment variables (complete list)

### Backend — `/app/backend/.env`
| Key | Required | Example / default | Purpose |
|-----|----------|-------------------|---------|
| `MONGO_URL` | ✅ | `mongodb://sah_user:STRONGPASS@127.0.0.1:27017/sah_prod?authSource=admin` | Mongo connection (use auth in prod) |
| `DB_NAME` | ✅ | `sah_prod` | Database name |
| `JWT_SECRET` | ✅ | *(64-char random)* | JWT signing secret — **generate a fresh one** |
| `CORS_ORIGINS` | ✅ | `https://autopilot.storyathome.com` | Comma-separated allowed origins (avoid `*` in prod) |
| `ADMIN_EMAIL` | ✅ | `admin@fundle.ai` | Seeded admin login |
| `ADMIN_PASSWORD` | ✅ | *(strong)* | Seeded admin password — **change for prod** |
| `MARKETING_EMAIL` | ✅ | `marketing@fundle.ai` | Seeded ops/marketing login |
| `MARKETING_PASSWORD` | ✅ | *(strong)* | Seeded ops password — **change for prod** |
| `EMERGENT_LLM_KEY` | ⬜ optional | *(key)* | AI Insights narrative. If unset, a rule-based fallback is used (app still works). See §7. |
| `CLAIM_EMAIL_TO` | ⬜ | `seller.support@myntra.com` | Default "to" on drafted claim emails |
| `CLAIM_FROM_NAME` | ⬜ | `Story At Home Finance` | "From" name on drafted claim emails |

Generate a JWT secret:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

### Frontend — `/app/frontend/.env` (used only at build time)
| Key | Required | Example | Purpose |
|-----|----------|---------|---------|
| `REACT_APP_BACKEND_URL` | ✅ | `https://autopilot.storyathome.com` | Public base URL of the API (NO trailing slash, NO `/api`). The app appends `/api`. |
| `WDS_SOCKET_PORT` | dev only | `443` | Dev server websocket; irrelevant to prod build |
| `ENABLE_HEALTH_CHECK` | dev only | `false` | Leave false |

> ⚠️ Because `REACT_APP_BACKEND_URL` is compiled into the static bundle, **if the domain changes you must rebuild the frontend.**

**Never commit `.env` files.** Store secrets in the client's secret manager / restricted file perms (`chmod 600`).

---

## 5. MongoDB setup (production)

```bash
# Install MongoDB 7.0 (Ubuntu) — follow the official repo instructions, then:
sudo systemctl enable --now mongod

# Create an app user with auth
mongosh <<'JS'
use admin
db.createUser({
  user: "sah_admin",
  pwd: "CHANGE_ME_STRONG",
  roles: [ { role: "root", db: "admin" } ]
})
use sah_prod
db.createUser({
  user: "sah_user",
  pwd: "CHANGE_ME_STRONG",
  roles: [ { role: "readWrite", db: "sah_prod" } ]
})
JS
```
Then enable auth in `/etc/mongod.conf`:
```yaml
security:
  authorization: enabled
net:
  bindIp: 127.0.0.1        # keep DB private; only the app host should reach it
```
`sudo systemctl restart mongod`.

Indexes are created automatically by the app on startup (users, sales, settlement, calculations, discrepancies, uploads, recovery, commission masters, etc.) — no manual index work needed. Enable backups (see §8).

---

## 6A. Deployment — native (systemd + Nginx)

### Backend
```bash
# as a service user, in /opt/sah/backend
python3.11 -m venv /opt/sah/venv
/opt/sah/venv/bin/pip install -r requirements.txt
```
`/etc/systemd/system/sah-backend.service`:
```ini
[Unit]
Description=Story At Home AutoPilot API
After=network.target mongod.service

[Service]
User=sah
WorkingDirectory=/opt/sah/backend
EnvironmentFile=/opt/sah/backend/.env
# 2–4 workers. Each worker runs the idempotent startup seed (safe).
ExecStart=/opt/sah/venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 --workers 2
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now sah-backend
```

### Frontend (build once, Nginx serves the static files)
```bash
cd /opt/sah/frontend
# set REACT_APP_BACKEND_URL in .env to the public domain first
yarn install --frozen-lockfile
yarn build          # outputs ./build
```

### Nginx — `/etc/nginx/sites-available/sah.conf`
```nginx
server {
    listen 80;
    server_name autopilot.storyathome.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name autopilot.storyathome.com;

    ssl_certificate     /etc/letsencrypt/live/autopilot.storyathome.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/autopilot.storyathome.com/privkey.pem;

    client_max_body_size 50M;         # Excel uploads
    gzip on;
    gzip_types text/plain text/css application/json application/javascript application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;

    # API -> FastAPI
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;      # large report/export generation
    }

    # Static React build (SPA fallback to index.html)
    root /opt/sah/frontend/build;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/sah.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d autopilot.storyathome.com
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6B. Deployment — Docker Compose (alternative, more portable)

`docker-compose.yml`:
```yaml
services:
  mongo:
    image: mongo:7.0
    restart: always
    command: ["--auth"]
    environment:
      MONGO_INITDB_ROOT_USERNAME: sah_admin
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_ROOT_PWD}
    volumes: [ "mongo_data:/data/db" ]

  backend:
    build: ./backend            # Dockerfile: python:3.11-slim, pip install -r requirements.txt
    restart: always
    env_file: ./backend/.env    # MONGO_URL points at mongo:27017
    depends_on: [ mongo ]
    command: uvicorn server:app --host 0.0.0.0 --port 8001 --workers 2

  web:
    build:                      # multi-stage: node:20 build -> nginx:alpine serve
      context: ./frontend
      args:
        REACT_APP_BACKEND_URL: https://autopilot.storyathome.com
    restart: always
    ports: [ "80:80", "443:443" ]
    depends_on: [ backend ]

volumes:
  mongo_data:
```
Backend `Dockerfile`:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn","server:app","--host","0.0.0.0","--port","8001","--workers","2"]
```
Frontend `Dockerfile` (multi-stage; bakes the backend URL at build):
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf   # same /api proxy + SPA fallback as §6A
```

---

## 7. AI Insights (LLM) — important hosting note

The "AI Insights → Morning Brief" narrative is generated via the **Emergent LLM gateway** (`emergentintegrations` + `EMERGENT_LLM_KEY`, model `claude-sonnet-4-6`). On the client's own server you have two clean options:

1. **Keep `EMERGENT_LLM_KEY`** — the library calls Emergent's hosted gateway over HTTPS. It will work off-platform as long as the key is valid and billed through Emergent, and the server has outbound internet. (Dependency on Emergent remains.)
2. **Fully self-contained** — leave `EMERGENT_LLM_KEY` empty. The endpoint automatically falls back to a **deterministic rule-based brief** (no external calls). Everything else in the app is 100% local. If they later want their own AI, we swap `routers/insights.py` to call Anthropic/OpenAI directly with the client's key.

No other feature uses any external service — reconciliation, calculations, masters, reports, recovery, seller support, weight, and returns are all local.

---

## 8. Operations: backups, security, monitoring

- **Backups**: nightly `mongodump` (see MIGRATION.md §3) to off-box storage; retain ≥14 days. Test a restore quarterly.
- **Security**:
  - Change all seeded passwords; set a strong unique `JWT_SECRET`.
  - Keep MongoDB bound to localhost / private network with auth on.
  - Set `CORS_ORIGINS` to the exact app domain (not `*`).
  - Terminate TLS at Nginx; auto-renew certs (`certbot renew` timer).
  - Firewall: expose only 80/443 publicly; 8001 and 27017 stay internal.
- **Monitoring**: `GET /api/health` (liveness) and `GET /health` (root probe) return `{"status":"ok"}` — wire them to the client's uptime monitor / load balancer health check.
- **Logs**: `journalctl -u sah-backend` (native) or `docker logs` (compose). The app logs to stdout.
- **Scaling**: uvicorn `--workers N` on one box; or run several backend instances behind Nginx `upstream`. The in-memory TTL cache is per-process (correctness is unaffected, just a slightly lower cache hit-rate across workers).

---

## 9. Quick validation after any deploy
```bash
curl -s https://autopilot.storyathome.com/api/health
curl -s -X POST https://autopilot.storyathome.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fundle.ai","password":"<prod-pass>"}'
# then open the site, confirm login + all sidebar pages render + branding reads "Story At Home … Powered by Fundle"
```
