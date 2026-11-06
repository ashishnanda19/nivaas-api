# Nivaas web app

Resident app and operations console for a gated township of 2,400 apartments in 28 towers (Pune). One installable web app for maintenance dues, complaints, gate visitors and amenities, with a console for the help desk and committee and a tablet screen for the gate.

This is the front end of the repository in `..`. It runs in two modes, chosen by one environment variable:

| `VITE_USE_MOCK` | What it talks to |
| --- | --- |
| `false` | The Nivaas API in the parent folder, at `VITE_API_URL`. This is how the live site runs. |
| `true` (default when unset in development) | A typed mock API (`src/lib/api/mock.ts`) with random latency, occasional simulated errors, and fictional data kept in `localStorage`. No server needed. |

## Run it

```bash
npm install
cp .env.example .env     # VITE_USE_MOCK=false and VITE_API_URL=http://localhost:4000 to use the API
npm run dev              # http://localhost:5173
npm run build            # type-check and production build (installable PWA)
npm test                 # Vitest: formatting, late fee, payment matching, UI components
npm run lint
```

To use the real API, start it first (see the root `README.md` and `deployment.md`: `docker compose up -d`, `npm run migrate`, `npm run seed`, `npm run dev`) and list this app's origin in its `CORS_ORIGINS`.

## Demo logins

Open `/login` and tap a role, or enter the number and OTP **123456**.

| Role | Name | Mobile | Lands on |
| --- | --- | --- | --- |
| Resident (owner, paid in full) | Neeraj Kulkarni, T07-1203 | 9800000001 | `/app` |
| Resident (tenant, 47 days overdue, water leak open) | Swati Joshi, T12-0408 | 9800000002 | `/app` |
| Resident (part paid, 18 days overdue) | Aamir Shaikh, T21-1601 | 9800000003 | `/app` |
| Resident (family member of T07-1203) | Meera Kulkarni | 9800000004 | `/app` |
| Help desk and accounts | Priya Deshmukh | 9800000010 | `/console/complaints` |
| Committee | Meera Nair | 9800000020 | `/console/dashboard` |
| Gate guard (dark tablet UI) | Gate 1 tablet | 9800000030 | `/guard` |

Residents see a one-time DPDP consent checkbox on first login. On the live site only these seven numbers accept the demo OTP.

Other routes: `/` landing page, `/design` component catalogue.

In `npm run dev` with the mock, a flask button (bottom left) switches role instantly and toggles simulation: random read errors, automatic answers for waiting visitors (12 s), and offline mode for the guard tablet. It is not included in production builds.

## Things worth trying

- **Pay a bill** as Swati: breakup (area × rate, late fee, total), test-mode sheet, success, PDF receipt, ledger.
- **Payment matching** as Priya (`Payments`): upload `samples/bank-statement.csv` from the repository root (the mock offers "Try with sample"). Open "Why this match", post all exact (a confirm step always appears), and resolve the rest in the Accounts queue.
- **Safety complaint** as a resident: write "gas smell near the meter room". It is escalated to the duty manager by rule and nobody can remove the flag.
- **Duplicates**: Tower 14 has ten flats reporting the same lift. They show as a stack on the board and as "10 flats reported this issue" on each resident's complaint. They are linked, never auto-closed.
- **Reminders** as Priya or Meera (`Reminders`): the daily payment reminders that were sent, in each resident's language. Priya can press Run now.
- **Targets** as Meera (`Dashboard`): the brief's three targets next to where each measure started and where it is now.
- **Guard offline**: switch the browser to offline (or tick "Simulate offline" in the mock's dev menu), log a visitor, then go back online. The entry waits on the tablet and syncs.
- **Language**: switch English, हिन्दी, मराठी on the login screen or under More.

## Structure

```
src/app                 router, layouts (resident, console, guard), session store
src/components/ui       Button, Input, Select, Card, Badge, StatusPill, Tabs, Sheet, Modal,
                        Toast, Skeleton, EmptyState, ErrorState, DataTable, Timeline, Stat,
                        ProgressRing, LanguageSwitcher, Avatar
src/features/<role>     resident, helpdesk, committee, guard, auth, public
src/lib/api             the one interface the UI talks to: http.ts (real API), mock.ts (demo data), index.ts picks one
src/lib/i18n            en, hi, mr (hi and mr are type-checked against en)
src/lib/matching.ts     bank statement matching used by the mock (the real API matches on the server)
src/mocks               seed data and the sample bank statement
```

Nothing in `features/` or `components/` imports the mock directly. Both implementations have the shape of the `Api` type.

## Design notes

- One accent (indigo), slate neutrals, semantic colours only for state. Tokens are CSS variables in `src/index.css`; dark mode redefines them.
- Amounts are always tabular numerals in Indian grouping (`₹1,06,600`).
- Every data screen goes through `Async`, which guarantees loading (skeleton), error (retry), empty and populated states.
- Guard screens use 64px+ targets, are forced to the dark theme, and show the DPDP notice visitors can read.

## Known limits

- Console strings are English only (they go through `t(key, default)` so translation can follow); resident and guard screens are translated into Hindi and Marathi, and those translations have not been reviewed by native speakers.
- With the real API, water supply and garden complaints show under Plumbing and Housekeeping because the UI has fewer categories than the API.
- In mock mode "Publish bills" records the run and an audit entry but does not change the three seeded flats' current bills, and the dashboard numbers are synthetic.
- Amenity fees are shown and recorded on the booking. They are paid at the help desk and are not added to the maintenance bill.
- Visitor approvals arrive by polling every few seconds, not by push.
- Browsers that block third-party cookies (Safari by default) cannot refresh a session when the web app and the API are on different domains, so sign-in lasts about 15 minutes there. The deployment rewrites `/api` through the web host to avoid this (see `deployment.md`).
