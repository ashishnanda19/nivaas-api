# Nivaas API

Backend for Nivaas, a resident app and operations console for a gated township (2,400 flats in 28 towers). One deployable modular monolith: Fastify, TypeScript, PostgreSQL with Prisma, optional Redis for background jobs.

The React front end lives in a separate repository and talks to this API under `/api/v1`.

## Quick start

```bash
cp .env.example .env            # then edit if needed
docker compose up -d            # Postgres on 5432, Redis on 6379
npm install
npm run migrate                 # applies committed migrations
npm run seed                    # demo data (add -- --reset to start over)
npm run dev                     # http://localhost:4000, docs at /docs
```

Without Docker, point `DATABASE_URL` at any PostgreSQL 14+ with the `btree_gist` extension available (it ships with Postgres).

| Script | What it does |
| --- | --- |
| `npm run dev` | API with reload |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run migrate` | `prisma migrate deploy` |
| `npm run migrate:dev` | Create a new migration while developing |
| `npm run seed` | Idempotent demo data |
| `npm test` | Vitest and Supertest (needs a test database, see below) |
| `npm run test:cov` | Same, with a coverage report |
| `npm run typecheck` | `tsc --noEmit` |

Tests use `DATABASE_URL_TEST` (default `postgresql://nivaas@localhost:5433/nivaas_test`). They truncate every table, so point it at a throwaway database. No test calls an external API; the model clients are replaced with fakes.

The API runs with no AI keys and no Redis. `GET /health` reports `db`, the `queue` mode (`redis` or `in-process`) and the `ai` mode (`rules-only`, `gemini+rules`, `groq+rules` or `gemini+groq+rules`).

## Environment

Names only; real values never go in git. See `.env.example`.

`DATABASE_URL`, `REDIS_URL` (optional), `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGINS`, `OTP_FIXED_CODE_ENABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`, `PAYMENT_WEBHOOK_SECRET`, `STORAGE_DIR`, `NODE_ENV`, `PORT`.

Variables are validated with Zod at boot and the process exits with a clear message if one is wrong. In production the fixed OTP and placeholder secrets are refused.

## Layout

```
src/
  app.ts, server.ts       app factory, process entry
  lib/                    config, db, logger, errors, money, auth guard, queue, storage, openapi
  modules/<name>/         routes, service, schema (Zod) per module
    auth flats billing payments matching complaints visitors amenities committee audit ai notices
  jobs/                   scheduled work
prisma/                   schema, migrations, seed
tests/                    mirrors the modules
samples/bank-statement.csv
```

Every module keeps HTTP in `routes.ts`, rules and database work in `service.ts`, and request shapes in `schema.ts`. The matching engine and the money helpers are pure functions with no database access.

## Money

All amounts are integer paise. Nothing uses floats.

- **Maintenance** = flat area (sq ft) x rate per sq ft per month (default 650 paise), rounded to the nearest whole rupee, in one function (`calcMaintenance`). 1,150 sq ft = Rs 7,475; 980 = Rs 6,370; 1,640 = Rs 10,660.
- **Late fee** (`calcLateFee`, one pure function). Assumption, because the bye-laws were not specified: a configurable grace period (default 5 days after the due date), then either a flat fee or **simple interest of 1.75 % per month (175 basis points), accrued pro rata per day** from the due date. Both are Society settings. A nightly job posts only the new part of the accrual, once per day, so re-running it adds nothing.
- **Ledger** is append-only. A database trigger rejects `UPDATE` and `DELETE` on `LedgerEntry`. Bills and late fees are positive, payments negative, each row carries a running balance, and a correction is a `REVERSAL` entry. Every entry has a unique reference per flat, which is what makes posting idempotent.
- Payments are applied to the oldest charge first. Overpayment creates an advance-credit entry. Partial payments leave the remainder outstanding.

## Roles and access

| Role | Can do |
| --- | --- |
| `RESIDENT` | Own flat's bills, payments, complaints, visitors, bookings, members |
| `HELPDESK` | All operational data, bill runs, statement matching, complaint handling, audit log |
| `COMMITTEE` | Read-only aggregates (`/committee/*`), notices, audit log. No flat-level data |
| `GUARD` | Create and sync visitor entries, verify pre-approval codes, move approved visitors in and out |
| `ADMIN` | Everything the help desk can |

Access is enforced twice: by a route guard (deny by default; every route declares its roles) and at the query level (a resident's queries are always filtered by their active flat memberships, so guessing another flat's ID returns 403 or 404, never data). The boundaries are covered in `tests/access.test.ts` and in each module's tests.

Login is mobile plus OTP. In development the OTP is the fixed code `123456` when `OTP_FIXED_CODE_ENABLED=true`. Otherwise it is random, stored hashed, expires in 5 minutes, allows 5 attempts, is limited to 3 requests per phone per 10 minutes and throttled per IP. Unknown numbers get the same response as known ones. Access tokens last 15 minutes; refresh tokens are httpOnly cookies, rotated on use, and re-use of an old one revokes the session. Every endpoint except auth and health rejects a user who has not recorded DPDP consent.

## Bank statement matching

`src/modules/matching/engine.ts` is pure: parsed rows plus a snapshot of flats in, classifications out. Signals each carry a weight and a plain-language reason:

- the narration or reference contains the flat identifier (`T07-1203`, `T07 1203`, `T071203`, `TWR 07 1203`, `07-1203`; the short `0703` form counts as weak)
- a UPI ID previously confirmed for a flat
- the amount equals the open bill, or the balance including late fee
- the payer name is similar to a registered resident (needs surname and first name or initial; weak)

| Class | When |
| --- | --- |
| `EXACT` | The amount equals what is due **and** a flat identifier or known UPI ID points to exactly one flat, with no competing candidate |
| `LIKELY` | One strong signal but not both; or a multiple of the monthly bill (two months); or a partial payment or overpayment with a strong identity; or the flat has nothing due |
| `UNCLEAR` | Several candidate flats, no identity signal, conflicting signals |

Labels: `partial`, `two_month`, `overpay`, `already_paid`, `duplicate`, `ambiguous`, `no_identity`. A duplicate is the same reference, or the same date, amount and payer, seen earlier in the file or in an already-posted payment.

Safety rules, enforced in the service layer and tested:

1. **Nothing posts automatically.** Uploading only stores suggestions. Posting needs an explicit call by a help-desk user.
2. `POST /matching/uploads/:id/post-all-exact` posts `EXACT` rows only, and re-checks each against today's dues first.
3. `LIKELY` and `UNCLEAR` rows go to the Accounts queue and need a person to pick the flat. A duplicate also needs `allowDuplicate: true`.
4. Posting creates the payment, ledger entries, receipt, row state and audit row in **one transaction**, and is idempotent per row.
5. A `KnownPayer` is learned only from a confirmed posting.

The CSV parser accepts header variants, headerless files, quoted fields, Indian number formats (`1,23,456.50`, `Rs.`), `DD/MM/YYYY`, `DD-MMM-YY` and ISO dates, drops blank lines, skips debit rows, and returns per-row errors without failing the file. Limits: 1 MB, 5,000 rows, `.csv` only. `samples/bank-statement.csv` covers exact, duplicate, partial, two-month, unclear and already-paid rows against the seed data.

## AI module

`LlmClient` has two implementations that call HTTP directly: Gemini (primary) and Groq's OpenAI-compatible endpoint (fallback), each with a hard 6 second timeout. If neither is configured, rate limited or reachable, a deterministic rules classifier with English, Hindi and Marathi keyword lists takes over. Filing a complaint never fails because a model is down.

Order of work for each complaint:

1. **Safety words first**, before any model call: fire or smoke, gas leak or smell, someone stuck in a lift, electric shock or short circuit, flooding, collapse, medical emergency, in English, Hindi and Marathi. A hit sets urgency to `CRITICAL`, sets `escalated`, assigns the duty manager, writes an audit row, and **cannot be changed by the model or by anyone clearing the flag**. Attempts to lower it return 409 and are logged. The model is only consulted for the category.
2. Phone numbers, emails, ID-like digit runs, flat codes and the flat's known resident names are redacted before text leaves the server.
3. The model must answer strict JSON validated with Zod. Invalid JSON, an unknown category or confidence under 0.5 gives category `OTHER` with `needsReview`, never a guess. Without a safety hit, a model cannot declare `CRITICAL`; it is capped at `HIGH`.
4. The AI suggestion and reason are stored apart from the final category. A resident may override it when filing; the help desk changes it in one call, audited.
5. Duplicates: same category, same tower, last 48 hours, token-overlap similarity of at least 0.34, not itself a safety escalation. They are **linked under the first complaint and never closed or merged**. Embeddings are not used; token overlap needs no external call.
6. Assignment picks the least-loaded staff member whose skills cover the category. `responseDueAt` comes from urgency (critical 15 min, high 2 h, normal 8 h, low 24 h; configurable on the Society). A job marks complaints with no response past their due time as overdue.

Identical requests are cached for 10 minutes and each user gets 20 model calls per hour; beyond that the rules classifier answers. Logs record provider, latency and fallbacks, never complaint text.

## Security checklist

- Every body, query and parameter is validated with Zod; bodies reject unknown fields. Prisma only, so queries are parameterised.
- Uploads: size caps (1 MB statements, 5 MB photos), extension and content checks, image type decided from magic bytes, generated file names, files stored outside any public path and served through short-lived signed links.
- Helmet, CORS allow-list from `CORS_ORIGINS`, global and per-route rate limits, OTP lockout.
- Secrets only from the environment, validated at boot, redacted in logs. `.env` is ignored; `.env.example` has placeholders.
- Payment confirmations are checked with an HMAC signature using a constant-time compare.
- CSV exports neutralise spreadsheet formulas.
- Audit log for every staff state change, escalation, blocked escalation removal, report export and each time a staff member views another person's phone number (`pii.view`).
- Data minimisation: phone numbers are masked in staff lists unless explicitly revealed (which is audited). Visitor photos get a delete-after date 90 days out, and a daily job deletes the file and clears the path; the visit record stays.
- Pre-approval codes are stored as keyed hashes only; the plain code is shown once. Guards are locked out after repeated wrong codes.

**Hosting and data residency.** The DPDP Act expects personal data of Indian residents to be handled with care about where it lives. Production hosting for a real township should be in an Indian cloud region. The free tiers named in `deployment.md` (Render, Neon or Supabase, Vercel) are a demo assumption and a limitation, not a recommendation for real resident data.

## Limitations

- Payments use a test gateway: the gateway endpoint signs a confirmation and sends it through the same webhook handler a real provider would use.
- SMS goes through a `MessageProvider` interface; only a console implementation exists.
- Photo storage is local disk behind a `Storage` interface. On free hosting with an ephemeral disk, uploaded photos do not survive a redeploy. Point the interface at S3-compatible storage before relying on it.
- Pre-approval codes cannot be shown again after creation, by design.
- Amenity fees are recorded on the booking but not charged to the ledger.
- Similarity for duplicate linking is word overlap; it will miss paraphrases that share few words.

See `deployment.md` for deployment steps and demo logins. Interactive API docs are served at `/docs` outside production.
