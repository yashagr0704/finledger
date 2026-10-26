# LedgerFlow

Practice management for Chartered Accountant firms: clients, recurring compliance work, task assignment, review workflows and deadlines. Branding lives in `src/config/brand.ts`.

This is a fully interactive frontend prototype. Data is seeded into the browser (localStorage) through a repository abstraction, so a real backend can replace it later.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
```

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
| `src/data/repository.ts` | Data access boundary (localStorage implementation) |
| `src/store/store.ts` | All mutations: permission checks, activity log, in-app notifications |
| `src/lib/` | Permissions, workflow transitions, metrics, recurrence periods, filters |
| `src/components/` | UI primitives (Radix + Tailwind), task drawer/forms/table/board, layout shell |
| `src/pages/` | Overview, Tasks, Clients, Calendar, Review Queue, Team, Reports, Notifications, Settings |

## Known limitations

- No backend or real authentication; data is per-browser.
- Recurring task generation is simulated (run on demand from Settings → Recurring templates); there is no background scheduler.
- Notifications are in-app only; no email, SMS or WhatsApp is sent.
- Attachments store file names and sizes only, not file contents.
- Compliance dates are configurable demo schedules, not authoritative statutory due dates.
- Simulated in the demo: notice fetching, GSTIN lookup (a small fictional directory; format and check digit are validated for real), WhatsApp sending and broadcasts, AI festival suggestions (template-based), invoice PDF/email.
