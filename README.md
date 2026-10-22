# LedgerFlow

Practice management for Chartered Accountant firms: clients, recurring compliance work, task assignment, review workflows and deadlines. Branding lives in `src/config/brand.ts`.

This is a fully interactive frontend prototype. Data is seeded into the browser (localStorage) through a repository abstraction, so a real backend can replace it later.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
```

## Demo mode

- Use the **Demo** role switcher in the top bar to view the app as the admin (Rohan), a manager/reviewer (Ananya, Vikram) or an employee (Priya, Arjun, …).
- **Reset demo data** is in the profile menu and in Settings → Demo data. Seed dates are generated relative to today.
- Role switching is not authentication. Permissions are enforced in the store actions (`src/lib/permissions.ts`), but everything runs in the browser, so production needs the same rules on a server.

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
