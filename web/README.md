# Nivaas

Resident app and operations console for a gated township of 2,400 apartments in 28 towers (Pune). One app for maintenance dues, complaints, gate visitors and amenities.

This is the **front end only**. Everything runs against a typed mock API (`src/lib/api`) with small random latency and an occasional simulated error. Data is fictional and kept in `localStorage`, so two browser tabs (for example a resident and a guard) see the same township.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and production build (installable PWA)
npm test           # Vitest: formatting, late fee, payment matching, UI components
npm run lint
```

## Demo logins

Open `/login` and tap a role, or enter the number and OTP **123456**.

| Role | Name | Mobile | Lands on |
| --- | --- | --- | --- |
| Resident (owner, paid in full) | Neeraj Kulkarni, T07-1203 | 9800000001 | `/app` |
| Resident (tenant, 47 days overdue, water leak open) | Swati Joshi, T12-0408 | 9800000002 | `/app` |
| Resident (part paid, 18 days overdue) | Aamir Shaikh, T21-1601 | 9800000003 | `/app` |
| Help desk and accounts | Priya Deshmukh | 9800000010 | `/console/complaints` |
| Committee | Meera Nair | 9800000020 | `/console/dashboard` |
| Gate guard (dark tablet UI) | Gate 1 tablet | 9800000030 | `/guard` |

Residents see a one-time DPDP consent checkbox on first login.

Other routes: `/` landing page, `/design` component catalogue.

In `npm run dev` a flask button (bottom left) switches role instantly and toggles simulation: random read errors, automatic answers for waiting visitors (12 s), and offline mode for the guard tablet. It is not included in production builds.

## Things worth trying

- **Pay a bill** as Swati: breakup (area × rate, late fee, total) → test-mode sheet → animated success → PDF receipt → ledger.
- **Payment matching** as Priya (`Payments`): "Try with sample" loads exact, partial, duplicate, unclear and two-month rows. Open "Why this match", post all exact (a confirm step always appears), and resolve the rest in the Accounts queue.
- **Safety complaint** as a resident: write "gas smell near the meter room". It is escalated to the duty manager by rule and the badge cannot be removed by anyone.
- **Duplicates**: Tower 14 has ten flats reporting the same lift. They show as a stack on the board and as "10 flats reported this issue" on each resident's complaint. They are linked, never auto-closed.
- **Guard offline**: tick "Simulate offline" in the dev menu, log a visitor, then untick it. The entry waits locally and syncs.
- **Language**: switch English, हिन्दी, मराठी on the login screen or under More.

## Structure

```
src/app                 router, layouts (resident, console, guard), session store
src/components/ui       Button, Input, Select, Card, Badge, StatusPill, Tabs, Sheet, Modal,
                        Toast, Skeleton, EmptyState, ErrorState, DataTable, Timeline, Stat,
                        ProgressRing, LanguageSwitcher, Avatar
src/features/<role>     resident, helpdesk, committee, guard, auth, public
src/lib/api             the one interface the UI talks to; mock.ts is the only mock-aware file
src/lib/i18n            en, hi, mr (hi and mr are type-checked against en)
src/lib/matching.ts     bank statement matching (pure, tested)
src/mocks               seed data and the sample bank statement
```

To connect a real backend, export an object with the same shape as `Api` from `src/lib/api/index.ts`. Nothing in `features/` or `components/` imports the mock directly.

## Design notes

- One accent (indigo), slate neutrals, semantic colours only for state. Tokens are CSS variables in `src/index.css`; dark mode redefines them.
- Amounts are always tabular numerals in Indian grouping (`₹1,06,600`).
- Every data screen goes through `Async`, which guarantees loading (skeleton), error (retry), empty and populated states.
- Guard screens use 64px+ targets and are forced to the dark theme.

## Known limits

- Console strings are English only (they go through `t(key, default)` so translation can follow); resident and guard screens are fully translated.
- "Publish bills" records the run and an audit entry but does not change the three seeded flats' current bills.
- Dashboard numbers are synthetic and scaled to 2,400 flats; complaints and visitors are real seed records.
- The simulated "auto-answer" for visitors exists only so a single reviewer can see the guard result screen.


## Using the real backend

By default the app runs on built-in demo data. To talk to the Nivaas API instead, copy `.env.example` to `.env.local`:

```
VITE_USE_MOCK=false
VITE_API_URL=http://localhost:4000
```

Then start the API (see its README), seed it, and run `npm run dev`. The demo logins work unchanged: they sign in with the same phone numbers and the OTP `123456` against the API's seeded users. The API must list this app's origin in its `CORS_ORIGINS`.

What changes with a real backend: bank statements are matched on the server (the page shows its plain-language reasons), payments go through the test gateway, the gate tablet gets only flat IDs and abbreviated names, pre-approval codes are shown once and remembered on the device that created them, and water supply and garden complaints show under Plumbing and Housekeeping because the UI has fewer categories than the API.
# Nivaas
