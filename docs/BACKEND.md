# LedgerFlow backend

This document explains how the backend is built, how to run and deploy it, and what to do next to finish the integrations.

The same React app runs in two modes:

| | Demo mode (default, GitHub Pages) | Backend mode (`VITE_BACKEND=1`) |
| --- | --- | --- |
| Data | Seeded into `localStorage` | PostgreSQL, one database for all firms |
| Sign-in | Role switcher, no passwords | Email + password, session cookie, invites |
| Permissions | Checked in the browser | Checked on the server (the browser check is for UX only) |
| Files | Names and sizes only | Uploaded and stored, downloadable |
| Scheduler | "Generate next period" by hand | Server job every 15 minutes |

## 1. Architecture

```
 Browser (React)                              Server (Fastify, Node 20+)
 ─────────────────                            ───────────────────────────────────────────
 store.exec('createTask', input)
   │ 1. run the command locally (optimistic)
   │ 2. POST /api/commands/createTask  ─────▶  zod-validate args → load firm → run the SAME
   │      { args, ids }                        command → save changed rows → audit log
   │                                     ◀───  { ok, version, result }
   │ 3. on error: toast + reload from server
   │
 EventSource /api/events  ◀──────────────────  "version" event after every change (any user)
   └─ debounced GET /api/bootstrap             returns only what this user may see
```

The key decision is that **business rules are written once**, in `src/domain/`. They are plain TypeScript functions that take a context (`db`, `me`, id generators) and change a draft of the firm's data. The browser runs them for instant feedback. The server runs the same code as the authority.

| Path | What it does |
| --- | --- |
| `src/domain/commands.ts` | All ~52 mutations: tasks, review workflow, clients, team, billing, notices, DSC, WhatsApp, drive… Each checks permissions and throws `PermissionError`, `ValidationError` or `NotFoundError`. |
| `src/domain/schemas.ts` | A zod schema for each command's arguments. The server rejects anything else. |
| `src/domain/scope.ts` | `scopeDatabase(db, me)`: trims the firm to what a user may see. This covers tasks and clients by role, billing only with the billing permission, chats only with WhatsApp, and only your own notes and reminders. It also hides other people's Aadhaar, PAN and address from non-admins and strips portal passwords. |
| `src/domain/jobs.ts` | The scheduler. It generates recurring tasks 20 days ahead, sends due-soon and overdue alerts, escalates to the manager after 7 days late, fires reminders, and warns about expiring DSCs. Alerts are idempotent through `notification.refKey`. |
| `src/domain/execute.ts` | Runs a command against a copy and reports the new ids it created. |
| `server/src/app.ts` | HTTP routes, security headers, the command endpoint, uploads, SSE and webhooks. |
| `server/src/auth.ts` | Login, logout, registration, invites, password change and sessions. |
| `server/src/firmStore.ts` | Loads and saves a firm. Each collection row is a `records` row; only changed rows are written; there is one version counter per firm. |
| `server/src/migrations.ts` | The SQL schema. Migrations run automatically on start. |
| `server/src/jobs.ts` | Runs `runScheduledJobs` for every firm every `JOB_INTERVAL_MIN`. A Postgres advisory lock means only one instance runs it. |
| `src/api/client.ts`, `src/store/store.ts` | The browser API client, optimistic queue and live updates. |
| `server/test/api.test.ts` | 26 API tests (auth, scoping, permissions, isolation, files, jobs, persistence, concurrency). |

### Data model

```
firms          id, data jsonb (firm profile/config), version
users          id, firm_id, email (unique), password_hash, data jsonb
records        firm_id, collection, id, data jsonb  — tasks, clients, invoices, notices, …
sessions       token_hash (sha256), user_id, expires_at (30 days)
invites        token_hash, user_id, expires_at (7 days), used_at
files          id, firm_id, task_id | client_id, name, size, storage key
audit_log      firm_id, user_id, command, args, created_at
```

Each document is stored as JSON in `records`. The domain types are still changing, and this keeps the server schema stable while they do. Typed tables can come later for hot paths such as reporting, without changing the API.

Every change runs in one transaction. It takes `SELECT … FOR UPDATE` on the firm row, runs the command, writes the changed rows and bumps `version`. Concurrent edits are therefore serialized per firm, and different firms never block each other.

### Security

- **Passwords:** bcrypt with cost 12.
- **Sessions:** a random 32-byte token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only the sha256 hash of the token is stored.
- **CSRF:** every non-GET `/api` call must send the `x-ledgerflow: 1` header. Browsers cannot add it cross-site without CORS.
- **Login:** rate-limited to 10 attempts per 15 minutes per IP. Unknown emails take the same time as wrong passwords.
- **Deactivation:** deactivating a member revokes their sessions immediately. Changing your password signs out your other devices.
- **Portal passwords:** encrypted at rest with AES-256-GCM using a key derived from `APP_SECRET`. They are never in bulk responses and are never sent back into the edit form (a blank password means "keep the saved one"). Each login has a stable id, so a saved password follows its login through edits but never moves to another portal. Two audited, `no-store` endpoints hand out one credential at a time:
  - `GET /api/clients/:id/logins/:loginId?portalId=…` reveals a password (Portal Login page).
  - `POST /api/clients/:id/logins/:loginId/launch` with `{ portalId }` returns the login ID and password for the **Login** button. It refuses a portal mismatch (409), a client the user can't see (404), a client who has left (403), and a login with no password (409). It is rate-limited to 30 a minute.

  In the browser-only demo, passwords are kept in memory and never written to `localStorage`.
- **Firm isolation:** every query is keyed by the session's firm. A test checks that a second firm sees nothing of the first.
- **Headers:** CSP, `X-Frame-Options: DENY`, `nosniff` and a strict referrer policy.

## 2. Run it locally

Requirements: Node 20 or newer. PostgreSQL is optional for development. Without `DATABASE_URL` the server uses embedded PGlite, which is Postgres compiled to WASM, in `.data/`.

```bash
npm install
npm run db:seed -- --password demo1234       # demo firm "Mehta Iyer & Associates"
npm run server:dev                            # API on http://localhost:8787 (auto-reload)
npm run dev:backend                           # web app on http://localhost:5173, proxies /api
```

All npm scripts work the same in Windows `cmd`/PowerShell, macOS and Linux. Backend mode is switched on by `.env.backend` (loaded via `vite --mode backend`).

Sign in as `rohan@mehtaiyer.demo` (admin), `vikram@mehtaiyer.demo` (manager) or `priya@mehtaiyer.demo` (employee), all with the password `demo1234`.

To start a real firm instead of the demo:

```bash
npm run db:create-firm -- --name "Sharma & Associates" --admin-name "Asha Sharma" --email asha@firm.in --password '…'
```

The admin then invites the team from **Employees → Add employee**. Each person gets a one-time link to set their password. The link is emailed when SMTP is configured; otherwise it is shown to the admin to share.

### Production build without Docker

```bash
npm run build:backend && npm run server:build
NODE_ENV=production APP_SECRET=… DATABASE_URL=postgres://… npm run server:start
```

On Windows (PowerShell), set the variables first:

```powershell
$env:NODE_ENV="production"; $env:APP_SECRET="…"; $env:DATABASE_URL="postgres://…"
npm run server:start
```

The API server also serves the built web app from `dist/` on the same origin, so no CORS setup is needed.

### Tests

```bash
npm run test:server                                         # in-memory PGlite
TEST_DATABASE_URL=postgres://… npm run test:server          # real PostgreSQL (wipes that DB's public schema)
npm run typecheck:server
```

## 3. Deploy

### Option A — Render (Blueprint included)

1. In Render, choose **New → Blueprint** and pick this repository. `render.yaml` creates the Docker web service, a PostgreSQL database and a disk for uploads.
2. Set `PUBLIC_URL` to the service URL, and set `SMTP_URL`/`MAIL_FROM` if you want invites emailed.
3. Open the service's **Shell** and create the first firm:
   `node dist-server/cli.mjs create-firm --name "…" --admin-name "…" --email … --password …`

### Option B — any Docker host (Railway, Fly.io, a VPS, ECS…)

```bash
docker build -t ledgerflow .
docker run -p 8787:8787 -v ledgerflow-data:/data \
  -e APP_SECRET=$(openssl rand -hex 32) \
  -e DATABASE_URL=postgres://user:pass@host:5432/ledgerflow \
  -e PUBLIC_URL=https://app.yourfirm.in \
  ledgerflow
```

Put it behind HTTPS (a load balancer or Caddy/nginx). Use a managed Postgres with daily backups.

### AWS RDS / Aurora PostgreSQL

Set `DATABASE_URL=postgresql://USER:PASSWORD@<instance>.<id>.<region>.rds.amazonaws.com:5432/<db>`. Percent-encode special characters in the password (`@` → `%40`, `#` → `%23`, `/` → `%2F`). For `*.rds.amazonaws.com` hosts the server uses SSL automatically. It verifies the certificate and hostname against Amazon's RDS root CA, which ships in `server/certs/rds-global-bundle.pem` and is copied into the Docker image, so you don't need `sslmode` or `rejectUnauthorized=false`. If you connect through an RDS Proxy, a custom DNS name or an IP, set `DATABASE_CA_FILE=server/certs/rds-global-bundle.pem` to keep verification on.

The server creates its tables on first start. The RDS security group must allow inbound TCP 5432 from wherever the server runs. To run `create-firm` from your own machine, temporarily allow your IP too.

### GitHub Pages stays the demo

`.github/workflows/pages.yml` still publishes the localStorage demo. It cannot host the backend, because Pages only serves static files.

### Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | — | `production` enables secure cookies, requires `APP_SECRET` and turns off public sign-up. |
| `DATABASE_URL` | — | PostgreSQL connection string. If unset, embedded PGlite is used (development only). |
| `DATABASE_CA_FILE` | — | PEM file of CAs to verify the database's certificate. Automatic for `*.rds.amazonaws.com`. |
| `PG_POOL_MAX` | `10` | Maximum database connections per server process. |
| `APP_SECRET` | auto (dev) | 32+ random chars. **Keep it stable**: it encrypts saved portal passwords. |
| `PUBLIC_URL` | `http://localhost:PORT` | Used in invite links. |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `DATA_DIR` | `.data` | Holds uploads and PGlite data. Mount a volume here. |
| `STORAGE_DIR` | `$DATA_DIR/files` | Where uploaded files are written. |
| `FILE_MAX_MB` | `25` | Upload size limit. |
| `STATIC_DIR` | `dist` | The built web app to serve. Leave unset to disable. |
| `ALLOW_SIGNUP` | `true` in dev, `false` in prod | Allows creating new firms from `/register`. |
| `CORS_ORIGIN` | — | Only needed if the web app is on a different origin. Cookies then use `SameSite=None`. |
| `COOKIE_SECURE` | `true` in prod | |
| `JOBS_ENABLED` / `JOB_INTERVAL_MIN` | `true` / `15` | The scheduler. |
| `SMTP_URL` / `MAIL_FROM` | — | Emails invites, e.g. `smtps://user:pass@smtp.provider.com:465`. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_FIRM_ID` | — | Turns on real WhatsApp sending and the delivery-status webhook. |
| `GST_API_URL` / `GST_API_KEY` | — | GSTIN lookup through a GSP. The URL is called as `GET {url}/{gstin}` with a Bearer token, and GSTN-style fields (`lgnm`, `tradeNam`, `pradr`…) are mapped. |

## 4. What is real and what still needs a provider

| Feature | Status with the backend |
| --- | --- |
| Accounts, roles, per-user permissions, invites | **Real** |
| Tasks, review workflow, checklists, comments, activity log | **Real**, with live updates between users |
| Clients, KYC files, client drive, documents in/out, DSC register | **Real**; files are stored on the server's disk |
| Recurring task generation, due/overdue alerts, escalations, reminders, DSC expiry | **Real** (server scheduler) |
| Billing: fees, invoices, payments, ledger | **Real** data; no PDF or e-invoice (IRN) yet |
| Portal login vault | **Real**, encrypted, reveal is audited |
| Notices | Entered by hand with **Add notice**. Automatic fetching needs a GSP plus client consent; the Income Tax portal has no public API. The seeded demo firm keeps the simulated "Fetch now". |
| GSTIN lookup | Check digit and PAN/state are validated for real. Name and address need `GST_API_URL` (a GSP account), otherwise the small demo directory is used. |
| WhatsApp | Simulated until the `WHATSAPP_*` variables are set. Then it uses the Meta Cloud API. Messages outside the 24-hour window need approved templates. |
| Email | Invites only, when `SMTP_URL` is set. |
| AI festival wishes | Template-based. Plug in an LLM call in `server/src/app.ts` if you want generated text. |

## 5. How to proceed from here

The order below follows what a firm needs to use this every day:

1. **Pilot deployment.** Deploy with Render or Docker, create the firm and invite 2–3 staff. Turn on daily Postgres backups and keep `APP_SECRET` in a password manager.
2. **Email.** Add an SMTP provider (SES, Postmark, Zoho) so invites and password resets go out automatically. Next, add a "forgot password" flow; `auth.ts` already has the invite-token machinery to reuse.
3. **Object storage.** For more than one server instance, add an S3/R2 driver next to `server/src/storage.ts`. The interface is `put`, `get` and `remove`, and the database only stores the key.
4. **WhatsApp Business.** Create a Meta app, verify the business number, get templates approved (due-date reminder, document request, festival wish) and set the `WHATSAPP_*` variables. Point the webhook at `/api/webhooks/whatsapp`.
5. **GST data.** Sign up with a GSP (e.g. Masters India, ClearTax, Cygnet) for GSTIN search and return-filing status. Notice download needs per-client consent through the GSP.
6. **Invoices.** Generate PDFs on the server, with e-invoicing (IRN) through the same GSP if your turnover requires it.
7. **Scale-out (only when needed).** One server handles a firm of hundreds of users. For many firms, run 2+ instances; live updates already fan out through Postgres `LISTEN/NOTIFY`, and the scheduler is protected by an advisory lock. Move uploads to S3 (step 3) first.
8. **Compliance.** Add a data-processing agreement and retention policy. Consider an export (JSON/Excel) for each firm and a way to delete a client's data on request.

### Adding a feature (developer workflow)

1. Add the type in `src/types/index.ts`.
2. Write the command in `src/domain/commands.ts`, with permission checks, `log()` for the activity feed and `notify()` for alerts. Register it in `commands`.
3. Add its zod argument schema in `src/domain/schemas.ts`. The server refuses commands without one.
4. Add a one-line wrapper in `src/store/store.ts` and call it from the UI.
5. If the data is sensitive, decide in `src/domain/scope.ts` who can see it.
6. Add an API test in `server/test/api.test.ts`.

You do not write a new endpoint for this. A command works in demo mode and backend mode as soon as these steps are done.
