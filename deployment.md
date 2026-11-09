# Nivaas: running and deploying

One repository, two apps: the **API** at the repository root and the **web app** in `web/`.

- Repository: https://github.com/ashishnanda19/nivaas-api
- Live web app: https://nivaas-api-hazel.vercel.app
- Live API: https://nivaas-api-qazk.onrender.com (health check: `/health`)

## Try it now (reviewer)

1. Open https://nivaas-api-hazel.vercel.app and use the **Demo logins** buttons on the sign-in page, or type a phone number from the table below with the OTP **123456**.
2. The API runs on a free host that sleeps when idle. **The first request after a pause can take up to a minute**; after that it is quick. If sign-in seems stuck, wait and try again once.
3. Open the same site on a phone to see the mobile layout. The resident app is an installable PWA (browser menu, "Add to Home screen").

### Demo logins

The demo OTP is **123456**. On the live site only the seven phones below accept it (`DEMO_OTP_PHONES`); any other number gets a random code that is texted only if the number is on the SMS allow-list (the live site allows one test number; Twilio is a trial account). Locally, with `OTP_FIXED_CODE_ENABLED=true`, every number accepts it.

| Role | Phone | Who |
| --- | --- | --- |
| Resident (owner) | 9800000001 | Neeraj Kulkarni, T07-1203, bill Rs 7,475, paid |
| Resident (tenant) | 9800000002 | Swati Joshi, T12-0408, bill Rs 6,370 unpaid, 47 days overdue, one open water-leak complaint |
| Resident (owner) | 9800000003 | Aamir Shaikh, T21-1601, bill Rs 10,660, Rs 5,000 paid, 18 days overdue |
| Resident (family member) | 9800000004 | Meera Kulkarni, member of T07-1203 |
| Help desk / accounts | 9800000010 | Priya Deshmukh |
| Committee | 9800000020 | Meera Nair |
| Guard tablet | 9800000030 | Gate 1 |

Other residents have generated numbers and are not meant for login. The first sign-in of a resident asks for DPDP consent.

### Things worth trying

- **Pay a bill (test mode)** as Aamir or Swati: breakup with late fee, test gateway, receipt PDF, ledger. Paying twice with the same click does not double post.
- **Bank statement matching** as Priya: upload `samples/bank-statement.csv`. You get exact, duplicate, already-paid, two-month and unclear rows with the reason for each. Nothing posts until you confirm. `Post all exact` posts only the exact rows and re-checks each against today's dues first. Unclear rows go to the Accounts queue where a flat is chosen by hand. The uploaded file is kept and can be downloaded again by the help desk (audited), and payer names on confirmed postings are remembered as a weak hint.
- **Safety escalation** as Swati: file a complaint such as "there is a gas smell in the kitchen" (or in Hindi or Marathi). It is escalated to the duty manager by rule, and nobody can lower it afterwards.
- **Duplicate linking:** Tower 14 has ten lift complaints linked under one parent. Duplicates are linked, never closed.
- **Guard tablet:** log a visitor with a photo, then approve or deny it as the resident. Switch the browser to offline and keep logging; entries sync when the network returns.
- **Pre-approved guest:** as Neeraj create a guest pre-approval, then enter the 6-digit code on the guard tablet. (The seeded sample code `482913` is only valid on the day the data was seeded.)
- **Committee dashboard** as Meera: collections against billing, on-time rate, dues ageing, top defaulting towers, complaint times, reopened rate, a card that sets the brief's three targets (on-time 70% to 90%, reopened 25% to under 8%, matching work down 80%) beside where each stands now, and a monthly report download.
- **Payment reminders** as Priya (Reminders in the console): the messages the daily job sent, 3 days before the due date, on it, and from day 5 overdue, in each resident's language. Press Run now; nothing is sent twice. Messages are recorded here and are delivered by Twilio only to allow-listed numbers; the live site allows one test number.
- **Languages:** switch English, Hindi and Marathi from the sign-in page or the menu.

### Notes on the sample data

- Days overdue is calculated live from fixed due dates. The seed sets them so Swati is 47 days and Aamir 18 days overdue on the day it is run; the numbers move forward as days pass. `npm run seed -- --reset` realigns them.
- The late fee is added on top of the bill, so Swati's dues show Rs 6,545 (bill Rs 6,370 plus late interest). The bill itself is Rs 6,370.

## Run it locally

Requirements: Node 20 or newer (the web app's test tools want Node 22), Docker (for Postgres and Redis) or any PostgreSQL 14+.

API:

```bash
cp .env.example .env            # then set DATABASE_URL to the local database
docker compose up -d            # Postgres on 5432, Redis on 6379 (Redis is optional)
npm install
npm run migrate                 # applies the committed migrations
npm run seed                    # demo data (use -- --reset to start over)
npm run dev                     # http://localhost:4000, OpenAPI docs at /docs
npm test                        # Vitest and Supertest; the suite wipes DATABASE_URL_TEST, so point it at a throwaway database
```

Web app:

```bash
cd web
cp .env.example .env            # VITE_USE_MOCK=false and VITE_API_URL=http://localhost:4000
npm install
npm run dev                     # http://localhost:5173
npm test                        # unit and component tests
npm run build                   # type check and production build
```

With `VITE_USE_MOCK=true` the web app runs on its built-in mock data and needs no API at all.

To run the API in a container as well: `docker compose --profile api up --build`, then `docker compose exec api node dist/prisma/seed.js`.

## How it is deployed

| Part | Where | How |
| --- | --- | --- |
| Database | Supabase Postgres (free tier, Singapore) | Session pooler connection string in `DATABASE_URL` |
| API | Render web service (free plan), Docker | `render.yaml` blueprint. Auto deploys from `main`. The container runs `prisma migrate deploy` and then starts, so only committed migrations are applied |
| Web | Vercel (hobby plan) | Project root directory `web`, framework preset Vite. `web/vercel.json` sends `/api/*` to the Render API and every other app route to `index.html` |
| CI | GitHub Actions | API job (Postgres and Redis services, typecheck, tests with coverage) and a web job (lint, tests, build) |

Order: create the database, deploy the API with its environment variables, seed once (`npm run seed -- --force-production` with `DATABASE_URL` pointing at the hosted database, demo environments only), deploy the web app with `VITE_API_URL` set to the API URL, then add the web URL to `CORS_ORIGINS` on the API.

The web app calls the API on its own domain: Vercel forwards `/api/*` to Render, so the session cookie is first-party and also works in Safari. For that, **leave `VITE_API_URL` unset on Vercel**. If it is set, the app calls the API directly on its other domain instead, which needs the web origin in `CORS_ORIGINS` and loses the session after the 15 minute access token in browsers that block third-party cookies. The cookie is `HttpOnly; Secure; SameSite=None` in production either way.

## Environment variables (names only)

API:

| Name | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` on the host |
| `PORT` | no | default 4000 |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `DATABASE_URL_TEST` | tests | a throwaway database; tests empty every table |
| `REDIS_URL` | no | leave empty to use the in-process scheduler |
| `REDIS_TEST_URL` | no | enables the Redis scheduler test |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | yes | 16 or more random characters each |
| `PAYMENT_WEBHOOK_SECRET` | yes | shared secret that signs payment confirmations |
| `CORS_ORIGINS` | yes | comma separated list of allowed web origins |
| `OTP_FIXED_CODE_ENABLED` | no | development only; refused in production |
| `DEMO_OTP_PHONES` | no | comma separated phones that accept the fixed demo code, also in production |
| `SMS_PROVIDER` | no | `console` (default, delivers nothing) or `twilio` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | with `twilio` | Twilio credentials and the number or service to send from |
| `SMS_ALLOWED_PHONES` | with `twilio` | comma separated numbers that may receive messages. A real provider refuses to start without it unless `SMS_ALLOW_ALL=true` |
| `SMS_ALLOW_ALL`, `SMS_DEFAULT_COUNTRY_CODE` | no | lift the allow-list on purpose; country code added to 10 digit numbers (default 91) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | no | primary model (default `gemini-2.5-flash-lite`). A free Gemini key allows only about 20 requests per model per day, after which Groq answers, so keep both keys set. Without keys the app runs on its rules classifier |
| `GEMINI_EMBEDDING_MODEL` | no | model that turns complaints into vectors for duplicate linking (default `gemini-embedding-001`, uses `GEMINI_API_KEY`) |
| `GROQ_API_KEY`, `GROQ_MODEL` | no | fallback model |
| `STORAGE_DRIVER`, `STORAGE_DIR` | no | `local` (default) or `db` for hosts with no persistent disk |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | no | S3-compatible storage; wins over the other drivers when `S3_BUCKET` is set |
| `S3_TEST_ENDPOINT`, `S3_TEST_KEY`, `S3_TEST_SECRET` | no | enables the S3 storage test |
| `LOG_LEVEL` | no | default `info` |

Web:

| Name | Notes |
| --- | --- |
| `VITE_USE_MOCK` | `true` runs on built-in mock data, `false` calls the API |
| `VITE_API_URL` | base URL of the API at build time. Leave it unset in production (the app then uses its own domain, see above). In development set `http://localhost:4000` |

`.env` files are gitignored; only `.env.example` files are committed.

## Text messages

Sign-in codes and payment reminders go through one `MessageProvider`. With `SMS_PROVIDER=console` (the default) a message is only logged and nothing is delivered. With `SMS_PROVIDER=twilio` it is delivered by Twilio's REST API.

Safety rules for a real provider:

- Nothing is texted unless the number is in `SMS_ALLOWED_PHONES` (or `SMS_ALLOW_ALL=true` was set on purpose). The server refuses to start with a real provider and neither, so seeded or test numbers can never be texted by accident.
- The seven demo accounts are never texted, whatever else is allowed. Generated resident numbers in the seed start with 5, which no mobile operator issues.
- A message that is held back shows as "Not sent" in the Reminders page, and is sent on a later run once the number is allowed. A failure shows as "Failed" and is retried. A failure to send a sign-in code does not change the reply to the user, so it cannot reveal which numbers are registered.

Twilio trial accounts can only text numbers verified in the Twilio console, which suits a demo. Sending to Indian numbers at scale needs the operator's DLT registration of the sender and each message template, which is an administrative step outside this code and takes days. The message texts are in `src/modules/reminders/messages.ts` and `src/modules/auth/service.ts` and would be registered as templates.

## Evaluations

Two scripts measure the AI and matching logic on labelled data and write their results next to the code in `eval/`:

```bash
npm run eval:ai          # rules classifier and safety rules on 66 labelled complaints (English, Hindi, Marathi), no network
npm run eval:ai:live     # also the full pipeline with the configured Gemini and Groq keys (about 7 minutes at free-tier pace)
DATABASE_URL=... npm run eval:matching   # the sample bank statement against what a human accountant would decide; needs a seeded database
npm run eval:dupes       # duplicate detection: word overlap against embeddings on 45 labelled pairs, threshold tuned on one half and reported on the other; needs GEMINI_API_KEY
```

The labelled sets were written by the author of the rules, so the figures are an optimistic bound, not a benchmark on independent data. Results are in `eval/RESULTS-*.md`.

## Duplicate complaints by meaning

A new complaint is compared with open complaints from the same tower and category in the last 48 hours. When both have an embedding from the same model the decision is by meaning (cosine similarity at 0.95 or more), which links "the lift is not working" with "आज सुबह से लिफ्ट बंद है". When either side has none, or the embedder fails or is out of quota, it falls back to word overlap, so a complaint is always filed. The text is redacted before it is embedded, and each link records how it was found (`meaning`, `words` or `manual`) and its score. Safety complaints are never linked.

Complaints created before embeddings were switched on have none. Compute them once, resumably, against the database in `DATABASE_URL`:

```bash
npm run embeddings:backfill -- --dry-run   # count only; prints the database host first
npm run embeddings:backfill
```

## Verify it yourself

Everything below was run on 9 November 2026; the results are quoted in the Technical Design Document.

```bash
# API tests need a throwaway Postgres 14+ (any port) and, optionally, Redis. The suite empties every table in DATABASE_URL_TEST.
DATABASE_URL_TEST=postgresql://nivaas@localhost:5433/nivaas_test REDIS_TEST_URL=redis://localhost:6379 npm test   # 365 pass, 3 skipped (need an S3 server)
npm run typecheck && npm run test:cov                                                                          # lines 94%, statements 91%
cd web && npm run lint && npm test && npm run build                                                            # 22 tests

# Evaluations (see the section below). The matching one needs a migrated and seeded database.
DATABASE_URL=postgresql://nivaas@localhost:5433/nivaas_eval npm run migrate && npm run seed
DATABASE_URL=... npm run eval:ai && npm run eval:matching && npm run eval:dupes

# Feature test of a LIVE site, 169 checks across every role and flow. It WRITES (pays bills, posts the sample statement, creates
# complaints, visitors and notices), so use a demo database, then restore it with: npm run seed -- --reset --force-production
node scripts/live-features.mjs https://nivaas-api-hazel.vercel.app samples/bank-statement.csv

# Read-only black-box smoke test of a running site, 68 checks (access matrix, validation, safety classification, reports)
node scripts/live-smoke.mjs https://nivaas-api-hazel.vercel.app      # or a local API, e.g. http://localhost:4000
```

## Keeping the live demo awake

The free API sleeps after about 15 minutes idle and the first request then takes up to a minute. A scheduled GitHub Actions workflow (`.github/workflows/keep-awake.yml`) requests `https://nivaas-api-qazk.onrender.com/health` every 10 minutes to avoid it. GitHub throttles scheduled runs (in practice they ran hours apart, not every 10 minutes), so the host does sleep and a cold start is expected: wait a minute and retry. A cold start took 53 seconds when measured on 9 November. For a steadier demo, also point a free external uptime monitor (for example UptimeRobot or cron-job.org, every 5 minutes) at `/health`; GitHub's scheduler cannot guarantee the interval.

The API also guards against a pooled database silently dropping idle connections: connect and pool timeouts are added to `DATABASE_URL` when absent, a failed connection-class query (Prisma P1001, P1002, P1008, P1017, P2024) is retried once, and a `SELECT 1` keeps a connection warm every 4 minutes while the process is awake. The HTTP server keeps idle connections open for 65 seconds (Node's default is 5), longer than the 60 second proxies in front of it, so a proxy never reuses a connection that was just closed.

## File storage

Complaint and visitor photos go through a storage interface with three drivers: local disk (default), Postgres rows (`STORAGE_DRIVER=db`, used on the live site because the free host has no persistent disk), and any S3-compatible bucket. Photos are limited to about 1.8 MB, checked by their first bytes, kept private, and served only through short-lived signed links. A daily job deletes visitor photos after 90 days.

## Dependency audit notes

`npm audit` reports four high advisories that need major upgrades: `zod` below 4.6.6 (memory use on very large constrained collections; request bodies are size capped and every route is rate limited) and `deepmerge-ts` inside the Prisma command line tool (a development dependency that never handles user input). Both are recorded here instead of forced and planned as separate upgrades.
