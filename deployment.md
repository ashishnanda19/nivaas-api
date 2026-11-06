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

The demo OTP is **123456**. On the live site only the seven phones below accept it (`DEMO_OTP_PHONES`); any other number gets a random code and there is no SMS provider connected. Locally, with `OTP_FIXED_CODE_ENABLED=true`, every number accepts it.

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
- **Bank statement matching** as Priya: upload `samples/bank-statement.csv`. You get exact, duplicate, already-paid, two-month and unclear rows with the reason for each. Nothing posts until you confirm. `Post all exact` posts only the exact rows and re-checks each against today's dues first. Unclear rows go to the Accounts queue where a flat is chosen by hand.
- **Safety escalation** as Swati: file a complaint such as "there is a gas smell in the kitchen" (or in Hindi or Marathi). It is escalated to the duty manager by rule, and nobody can lower it afterwards.
- **Duplicate linking:** Tower 14 has ten lift complaints linked under one parent. Duplicates are linked, never closed.
- **Guard tablet:** log a visitor with a photo, then approve or deny it as the resident. Switch the browser to offline and keep logging; entries sync when the network returns.
- **Pre-approved guest:** as Neeraj create a guest pre-approval, then enter the 6-digit code on the guard tablet. (The seeded sample code `482913` is only valid on the day the data was seeded.)
- **Committee dashboard** as Meera: collections against billing, on-time rate, dues ageing, top defaulting towers, complaint times, reopened rate, and a monthly report download.
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
| Web | Vercel (hobby plan) | Project root directory `web`, framework preset Vite, `web/vercel.json` rewrites app routes to `index.html` |
| CI | GitHub Actions | API job (Postgres and Redis services, typecheck, tests with coverage) and a web job (lint, tests, build) |

Order: create the database, deploy the API with its environment variables, seed once (`npm run seed -- --force-production` with `DATABASE_URL` pointing at the hosted database, demo environments only), deploy the web app with `VITE_API_URL` set to the API URL, then add the web URL to `CORS_ORIGINS` on the API.

The refresh cookie is `HttpOnly; Secure; SameSite=None` in production so it works between the two domains. Browsers that block third-party cookies (Safari by default) cannot refresh a session, so sign-in lasts only as long as the 15 minute access token. A custom domain shared by both apps would remove this.

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
| `GEMINI_API_KEY`, `GEMINI_MODEL` | no | primary model. Without keys the app runs on its rules classifier |
| `GROQ_API_KEY`, `GROQ_MODEL` | no | fallback model |
| `STORAGE_DRIVER`, `STORAGE_DIR` | no | `local` (default) or `db` for hosts with no persistent disk |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | no | S3-compatible storage; wins over the other drivers when `S3_BUCKET` is set |
| `S3_TEST_ENDPOINT`, `S3_TEST_KEY`, `S3_TEST_SECRET` | no | enables the S3 storage test |
| `LOG_LEVEL` | no | default `info` |

Web:

| Name | Notes |
| --- | --- |
| `VITE_USE_MOCK` | `true` runs on built-in mock data, `false` calls the API |
| `VITE_API_URL` | base URL of the API, for example `https://nivaas-api-qazk.onrender.com`; build time |

`.env` files are gitignored; only `.env.example` files are committed.

## File storage

Complaint and visitor photos go through a storage interface with three drivers: local disk (default), Postgres rows (`STORAGE_DRIVER=db`, used on the live site because the free host has no persistent disk), and any S3-compatible bucket. Photos are limited to about 1.8 MB, checked by their first bytes, kept private, and served only through short-lived signed links. A daily job deletes visitor photos after 90 days.

## Dependency audit notes

`npm audit` reports four high advisories that need major upgrades: `zod` below 4.6.6 (memory use on very large constrained collections; request bodies are size capped and every route is rate limited) and `deepmerge-ts` inside the Prisma command line tool (a development dependency that never handles user input). Both are recorded here instead of forced and planned as separate upgrades.
