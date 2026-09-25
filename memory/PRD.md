# PRD — Story At Home · Marketplace AutoPilot (Fundle)

## Original Problem Statement
Clone the existing `Latin-Marketplace` app (FastAPI + React + MongoDB), reproduce it exactly, rebrand (display-only) to the **Story At Home** tenant, clean-seed with **no Latin Quarter data**, and extend from single-marketplace (Myntra) toward multi-marketplace ingestion. Keep architecture, reconciliation logic and document shapes identical. Then add three operational modules requested by the user:
1. **Seller Support** — raise queries with marketplace seller support, reply/record seller responses, follow up on cases.
2. **Weight-Charge Discrepancy Management** — identify/manage weight-charge discrepancies, SKU-wise weight-charge corrections, dashboard status tracking.
3. **Return Orders Management** — dashboard to monitor return orders, automated ticket creation for return issues, status/resolution tracking.

## Architecture
- **Backend**: FastAPI (`/api` prefixed), MongoDB via `MONGO_URL`/`DB_NAME`. Routers: masters, uploads_r, calculations, reconciliation, dashboards, reports, recovery, insights, pnl, claims, **seller_support, weight, returns**. Pipeline: latin_loader (Myntra), derive_masters, reingest_all. Auth = JWT (bcrypt), admin + marketing seeded on startup.
- **Frontend**: React (CRA/craco, yarn), shadcn UI. 15 base pages + Layout + 3 new pages + MarketplaceSelector.
- **Env only**: MONGO_URL, DB_NAME, REACT_APP_BACKEND_URL, JWT_SECRET, ADMIN_*, MARKETING_*, EMERGENT_LLM_KEY, CLAIM_*.

## User Personas
- **Admin** — full access, config, masters, tax rates.
- **Marketing / Ops** — uploads, reconciliation, recovery, reports, seller support, returns, weight disputes.

## Core Requirements (static)
- Dual-basis reconciliation engine UNCHANGED (Settlement default + Contract-audit); sales legs never month-filtered; TCS = IGST_TCS+CGST_TCS+SGST_TCS.
- Tax/rate tables user-editable via Masters (no hardcoded flat rate).
- Branding reads "Story At Home · Marketplace AutoPilot — Powered by Fundle" (display-only; internal identifiers/filenames/collections/brand data keys unchanged).
- Clean seed: empty sales/settlement/calculations/discrepancies + empty contract masters; only admin+marketing users, tolerance/tax/settlement config singletons.

## Implemented (2026-06)
- **Phase 1–2**: Cloned Latin-Marketplace into /app; app runs; login works; all 15 base pages render. Rebranded all display strings (index.html, Layout, Login, Masters, server title/health id, masters brand/restore/export filename, reports Excel title/filename, claims CLAIM_FROM_NAME, loader labels via env). SAH monogram + Story At Home name in sidebar/login; Powered by Fundle kept.
- **Phase 3**: Clean-seed — removed `latin_masters_seed.json` and the LQ masters seed call at startup; startup seeds config singletons only (tolerance/tax/settlement) + admin + marketing. Masters start empty and are tenant-editable.
- **Phase 4**: Reconciliation/calc engine untouched.
- **Phase 5 (stub)**: `GET /api/marketplaces` (Myntra active; Amazon/Flipkart/Ajio/Tata Cliq/Own Site planned). `MarketplaceSelector` filter on new pages. Adapters gated on real sample files.
- **New modules** (all API + UI, 21/21 backend tests + all critical UI flows pass):
  - Seller Support (`support_tickets`): create/list/detail, threaded messages with agent→awaiting_seller / seller→responded status flips, priority, status patch, summary KPIs.
  - Weight Discrepancies (`weight_discrepancies`): create/list/patch with server-side weight & amount variance + recoverable computation, SKU-wise weight edits, status workflow, raise-ticket (→ linked seller-support ticket, status disputed), summary KPIs.
  - Return Orders (`return_orders`): create/list/patch, auto seller-support ticket on problem statuses (qc_failed/damaged/lost_in_transit) both on create and on status transition, manual create-ticket, scan-from-sales, summary KPIs, issues-only filter.

## Backlog / Remaining
- **P1**: Build per-marketplace loader adapters (Amazon first, then Flipkart/Ajio/Tata Cliq/Own Site) — BLOCKED pending one real order file + one payout file per marketplace. Each maps to identical output doc shapes; tag `portal_name`; then derive_masters → reingest_all → verify Settlement-basis Discrepancies reconcile cleanly.
- **P2**: Re-verify Myntra reference against a clean Story At Home Myntra export (not LQ data).
- **P2**: Optional RBAC hardening on new-module mutating routes if Ops must be read-only in some areas.
- **P2**: Apply real Story At Home logo + brand accent colors when provided (currently SAH monogram placeholder).

## Next Tasks
- Collect Amazon sample order + payout files → build `amazon` adapter.
- Provide/replace SAH logo asset + hex accents.
