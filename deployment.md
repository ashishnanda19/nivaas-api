# Deployment and demo guide

## Local setup

1. `cp .env.example .env`
2. `docker compose up -d` (Postgres and Redis)
3. `npm install`
4. `npm run migrate && npm run seed`
5. `npm run dev` (API on `http://localhost:4000`, docs on `/docs`)
6. In the front-end repository set `VITE_API_URL=http://localhost:4000` and `VITE_USE_MOCK=false`, then `npm run dev`.

To reset the demo data (due dates are relative to the day you seed): `npm run seed -- --reset`.

## Environment variables

Names only. Set values in your host's dashboard, never in git.

| Name | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` on the host |
| `PORT` | no | default 4000 |
| `DATABASE_URL` | yes | Neon or Supabase connection string |
| `REDIS_URL` | no | leave empty to use the in-process scheduler |
| `JWT_SECRET` | yes | 16+ random characters |
| `JWT_REFRESH_SECRET` | yes | 16+ random characters, different from the above |
| `CORS_ORIGINS` | yes | comma separated, e.g. the Vercel URL |
| `OTP_FIXED_CODE_ENABLED` | no | must be `false` in production |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | no | primary model |
| `GROQ_API_KEY`, `GROQ_MODEL` | no | fallback model |
| `PAYMENT_WEBHOOK_SECRET` | yes | shared secret for payment confirmations |
| `STORAGE_DIR` | no | where uploads are stored |

## Deploying (free-tier demo)

1. **Database.** Create a project on Neon or Supabase and copy the connection string into `DATABASE_URL`.
2. **API on Render.** Create a Blueprint from `render.yaml` (or a Docker web service by hand). Fill in `DATABASE_URL` and `CORS_ORIGINS`; the JWT and webhook secrets are generated. The container runs `prisma migrate deploy` before it starts, which only applies committed migrations.
3. **Seed once.** From a Render shell, or locally with `DATABASE_URL` pointing at the hosted database: `npm run seed -- --force-production`. Do this only for a demo environment.
4. **Front end on Vercel.** Set `VITE_API_URL` to the Render URL and `VITE_USE_MOCK=false`. Add the Vercel URL to `CORS_ORIGINS` on the API.
5. **Cookies.** In production the refresh cookie is `Secure` and `SameSite=None` so it works across the two domains. Both sites must be served over HTTPS.
6. Check `GET /health`. `ai` shows `rules-only` until a model key is set.

Free tiers sleep when idle, so the first request after a pause is slow. For real resident data use an Indian cloud region (see README).

## Demo logins

Sign in with the phone number; the demo OTP is **123456** while `OTP_FIXED_CODE_ENABLED=true`.

| Role | Phone | Who |
| --- | --- | --- |
| Resident (owner) | 9800000001 | Neeraj Kulkarni, T07-1203, bill Rs 7,475, paid |
| Resident (tenant) | 9800000002 | Swati Joshi, T12-0408, bill Rs 6,370 unpaid, 47 days overdue, open water-leak complaint |
| Resident (owner) | 9800000003 | Aamir Shaikh, T21-1601, bill Rs 10,660, Rs 5,000 paid, 18 days overdue |
| Resident (family) | 9800000004 | Meera Kulkarni, member of T07-1203 |
| Help desk | 9800000010 | Priya Deshmukh |
| Committee | 9800000020 | Meera Nair |
| Guard | 9800000030 | Gate 1 tablet |

Other residents have generated numbers and are not meant for login.

Useful things to try:

- Upload `samples/bank-statement.csv` as the help desk: exact, duplicate, partial, two-month, unclear and already-paid rows. Post the exact ones with `post-all-exact`.
- File a complaint as Swati saying "there is a gas smell in the kitchen" and watch it escalate to the duty manager.
- Tower 14 has a cluster of ten lift complaints linked under one.
- As a guard, verify the pre-approval code **482913** (for T07-1203, valid today).
- As a resident, pay a bill through the test gateway, then download the receipt.
