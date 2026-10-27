# LedgerFlow

Practice management for Chartered Accountant firms: clients, recurring compliance work, task assignment, review workflows and deadlines. Branding lives in `src/config/brand.ts`.

It runs in two modes:

- **Demo** (default, hosted on GitHub Pages): a seeded firm in the browser's localStorage, with a role switcher and no sign-in.
- **Backend**: a Node/Fastify API with PostgreSQL, real accounts and invites, server-side permissions, file storage, a scheduler and live updates. See **[docs/BACKEND.md](docs/BACKEND.md)** for the architecture, setup, deployment and roadmap.

## Run

```bash
npm install
npm run dev      # demo mode: http://localhost:5173
npm run build    # type-check + production build
```

With the backend:

```bash
npm run db:seed -- --password demo1234   # demo firm in embedded Postgres (.data/)
npm run server:dev                        # API on :8787
npm run dev:backend                       # web app on :5173 → sign in as rohan@mehtaiyer.demo / demo1234
npm run test:server                       # API test suite
```

Deploy with the included `Dockerfile` or `render.yaml` (details in docs/BACKEND.md).

## Hosting

Live demo: https://yashagr0704.github.io/finledger/

`.github/workflows/pages.yml` builds with `npm run build:pages` (hash-based URLs, relative asset paths) and publishes `dist/` to the `gh-pages` branch on every push. GitHub Pages serves that branch (Settings → Pages → Deploy from a branch → `gh-pages` / root).

## Demo mode

- Use the **Demo** role switcher in the top bar to view the app as the admin (Rohan), a manager/reviewer (Ananya, Vikram) or an employee (Priya, Arjun, …).
- **Reset demo data** is in the profile menu and in Settings → Demo data. Seed dates are generated relative to today.
- Role switching is not authentication. Permissions are enforced in the store actions (`src/lib/permissions.ts`), but everything runs in the browser, so production needs the same rules on a server.

## Modules

- **Work Station:** dashboard (group tabs All/GST/Income Tax/TDS/MCA/Other/To-do with due/overdue buckets, colour-dot deadline calendar, task overview, compliance due, team performance), tasks (table + Kanban), review queue, compliance calendar, notes & reminders, portal login, notices.
- **Master:** clients (tabbed add/alter form with GSTIN validation & auto-fill, billing name, entry/exit dates, contacts, custom fields, portal logins, attachments), employees (profile, temporary/permanent delete, per-user permissions), groups & services, referred by.
- **Billing** (permission-gated): work in progress with advances, unbilled works → invoices, billed works with payments, client ledger.
- **Other services:** DSC status, documents in/out register, WhatsApp (chats, broadcasts, AI-suggested festival wishes), client drive, reports.
- **My Account:** company profile, configuration, users & roles (permission switches), templates, demo data.

## Structure

| Path | Purpose |
| --- | --- |
| `src/types` | Typed domain model |
| `src/data/seed.ts` | Deterministic demo firm (10 people, 14 clients, ~50 live tasks + 6 months of history) |
| `src/data/repository.ts` | Data access boundary (localStorage implementation, demo mode) |
| `src/domain/` | Business rules shared by browser and server: commands, argument schemas, per-user scoping, scheduler |
| `src/store/store.ts` | App state; runs commands locally and, in backend mode, sends them to the API |
| `src/api/client.ts` | API client (backend mode) |
| `server/` | Fastify API, PostgreSQL persistence, auth, files, jobs, CLI and tests |
| `src/lib/` | Permissions, workflow transitions, metrics, recurrence periods, filters |
| `src/components/` | UI primitives (Radix + Tailwind), task drawer/forms/table/board, layout shell |
| `src/pages/` | Overview, Tasks, Clients, Calendar, Review Queue, Team, Reports, Notifications, Settings |

## Known limitations

Demo mode (GitHub Pages):

- No real authentication; data is per-browser.
- Recurring generation runs only on demand; attachments store file names only; notifications are in-app only.

Both modes:

- Compliance dates are configurable schedules, not authoritative statutory due dates.
- These features need a provider account to be real: automatic notice fetching, GSTIN name/address lookup, WhatsApp sending, invoice PDF/e-invoicing, AI festival suggestions (template-based today). See docs/BACKEND.md §4–5.
