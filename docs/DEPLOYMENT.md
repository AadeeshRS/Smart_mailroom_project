# Deployment

Status: the shared database exists on Neon and has the schema. The API isn't deployed yet; the Render steps below
are ready to follow once the account exists.

## Shared database (Neon)

| | |
|---|---|
| Project | `smart-mailroom` (ID `square-surf-37664459`), organization `org-delicate-sky-91894943` |
| Region | `aws-ap-southeast-1` (Singapore), the same region planned for Render |
| Postgres | 17 |
| Branch / database / role | `main` / `smart_mailroom_dev` / `neondb_owner` |
| Migrations applied | `202611140001_v2_baseline`, `202611150001_collection_per_member` (2026-11-14), `202611150002_parcel_day_indexes` (2026-11-15) |

- The connection string lives **only** in `api/.env.neon` on the machine that set it up (git-ignored through
  `.env.*`), and in Render's environment once the API is deployed. It never goes in chat, logs or commits.
- It's the **direct (non-pooled)** URL with `sslmode=require`. Migrations need a direct connection, and one API
  instance with a 12-connection pool doesn't need Neon's pooler.
- `api/.env` stays pointed at the local `smart_mailroom_dev`. The tests only ever run against the local
  `smart_mailroom_test`.
- Never run `prisma migrate reset`, `prisma db push`, the seed, the API tests or the browser suites against Neon.
- To check the schema from a laptop without touching `api/.env` (from `api/`):
  `node --env-file=.env.neon node_modules/prisma/build/index.js migrate status`. A variable that's already set
  wins over `prisma.config.ts` loading `.env`, and a missing `.env.neon` is an error, not a fallback. Check that
  the `Datasource` line ends in `neon.tech`.
- Once Render is running, its start command applies new migrations before the server starts (`migrate deploy` does
  nothing when the schema is current), so nobody needs to migrate Neon by hand.

## Requirements

### Memory: Render's Free instance (512 MB) is enough

Passwords are hashed with scrypt (N = 2^14, r = 8, p = 5, OWASP's equivalent of N = 2^17, p = 1), which needs
**16 MiB per hash or check**. Node runs at most four at once (its thread pool), so scrypt uses at most 64 MiB on top
of Node and Prisma.

### Render's Free plan: sleeps when idle, no Pre-Deploy, no Shell

- The service **sleeps after 15 minutes with no requests**. The next request wakes it and takes about a minute; the
  app shows its normal loading state meanwhile.
- The **background worker runs only while the service is awake**. It expires old requests and collection codes,
  deletes stale rows, and (from Phase 6) sends pushes and reminders. An operator logging a parcel wakes the service,
  so its push still goes out within a minute; reminders and expiries wait for the next wake. A collection code is also
  checked against its expiry time when it's used, so a sleeping worker never lets an old code work.
- There's **no Pre-Deploy command**, so the start command runs the migrations first, and **no Shell**, so the first
  admin is created from a laptop (below).
- Neon also suspends its database after a few idle minutes; the first query after that takes a moment longer.

### Email: Resend's free plan is too small for registration day

Every registration, resend, password reset and operator invite sends one email. Resend's free plan allows
**100 emails per day** (3,000 per month); paid plans have no daily limit
([Resend: what is Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing), checked
2026-11-14). A few hundred students registering at the start of term would hit the free cap within hours, and
everyone after that gets no code. **Production needs a paid Resend plan, or another provider such as Amazon SES or
Brevo** (that means a new sender in `api/src/modules/notifications/email.ts`).

## Render setup, click by click

1. Sign in at [dashboard.render.com](https://dashboard.render.com) with GitHub. Click **New** → **Web Service**.
2. Under **Git Provider**, pick `AadeeshRS/Smart_mailroom_project`. If it isn't listed, the repo owner has to give
   Render's GitHub app access to that repository.
3. Fill in the form:

   | Field | Value |
   |---|---|
   | Name | `smart-mailroom-api` (the URL becomes `https://smart-mailroom-api.onrender.com`) |
   | Language | Node |
   | Branch | `arnav` for now (`main` once the work is merged) |
   | Region | Singapore (Southeast Asia), next to the database |
   | Root Directory | `api` |
   | Build Command | `npm ci --include=dev && npm run generate && npm run build` |
   | Start Command | `npm run migrate && npm start` |
   | Instance Type | **Free** |

   `--include=dev` matters: with `NODE_ENV` set, a plain `npm ci` skips TypeScript and the Prisma CLI, which the
   start command needs for `npm run migrate`.
4. Open **Advanced**:
   - **Health Check Path**: `/readyz`
   - **Auto-Deploy**: On Commit
5. Under **Environment Variables**, click **Add Environment Variable** for each row. Leave out anything marked
   "don't set".

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | **Secret, I type it myself.** The same direct URL as in `api/.env.neon` |
   | `CREDENTIAL_PEPPER` | **Secret, I type it myself.** 32+ random bytes, e.g. from `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Keep a copy in a password manager. It must never change: emailed codes are checked against it |
   | `RESEND_API_KEY` | **Secret, I type it myself**, once the Resend account exists. Don't set it before then |
   | `MAIL_FROM` | **Secret, I type it myself**, with the key: the verified sender, e.g. `Smart Mailroom <mailroom@your-domain>` |
   | `NODE_ENV` | `staging` until Resend is set up (see the next section), then `production` |
   | `ALLOWED_EMAIL_DOMAINS` | The college domain(s), comma-separated. Required even in staging: with none, nobody can register |
   | `HOST` | `0.0.0.0` |
   | `TRUST_PROXY` | `1` (Render's proxy is one hop; rate limits then see the real client IP) |
   | `NODE_VERSION` | `24` (matches `engines` in `api/package.json`) |
   | `PORT` | Don't set: Render provides it |
   | `CORS_ORIGINS` | Don't set: the phone app doesn't need it (only a hosted web build would) |
   | `REQUEST_EXPIRY_DAYS`, `COLLECTION_CODE_MINUTES`, `WAITING_TOO_LONG_DAYS`, `REMINDER_AFTER_DAYS`, `RATE_*` | Don't set unless changing the defaults (30 days, 15 minutes, 7 days, 3 days, the limits below) |
   | `SEED_PASSWORD`, `CONTRACT_PATH` | Don't set |

6. Click **Deploy Web Service** and watch **Logs**. The build ends with `tsc`. On start, `npm run migrate` shows
   `No pending migrations to apply` (or applies new ones), then the server starts and the service goes live.
7. Open `https://smart-mailroom-api.onrender.com/readyz`; it should answer `{"ok":true}`.
8. Point the app at it: in `mobile/.env`, `EXPO_PUBLIC_API_BASE_URL=https://smart-mailroom-api.onrender.com/v1`,
   then restart `npx expo start`.

## Test accounts on the hosted server before Resend exists

`NODE_ENV=production` refuses to start without `RESEND_API_KEY` and `MAIL_FROM`, so until Resend exists the
service runs with `NODE_ENV=staging`. Then nothing is emailed: every code (verification, password reset, operator
invite) is printed to the service's **Logs** as `[email to <address>] ... Your code is 123456`. Anyone who can read
the logs can read the codes, so this is for the team's testing with test parcels only, never for real students.

1. **First admin, from your own PC** (the Free plan has no Shell). In `api/`, run

   ```
   npm run create-admin:neon -- your.name@college.edu "Your Name"
   ```

   It reads the database URL only from `api/.env.neon` (never `api/.env`), refuses any host that doesn't end in
   `neon.tech`, and only creates the account: nothing is emailed and no URL is printed. Then, in the app pointed at
   Render, tap **Forgot password** and enter the same email. Render's **Logs** show
   `[email to your.name@college.edu] ... Your code is 123456`; enter that code and a new password.
2. **Teammates as members.** They register in the app with an address on `ALLOWED_EMAIL_DOMAINS`. Whoever has
   Render access searches **Logs** for `[email to their.address` and passes them the code.
3. **Teammates as operators or admins.** An admin adds them in the app (**Dashboard → Users**); the invite code
   appears in **Logs**, and they set a password with it through **Forgot password**.
4. Don't run the seed on this database: its fixture accounts share one known password, on a server anyone can
   reach.

**Going live:** add `RESEND_API_KEY` and `MAIL_FROM`, change `NODE_ENV` to `production`, and save. Render redeploys,
and from then on codes are emailed and no longer logged.

## API environment variables (reference)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Hosted: the direct Neon URL with `sslmode=require` (see above) |
| `CREDENTIAL_PEPPER` | yes | At least 32 random bytes. Keep it stable and backed up: changing it invalidates pending codes |
| `NODE_ENV` | yes | `production` refuses to start without the email and domain variables below |
| `ALLOWED_EMAIL_DOMAINS` | yes, to register anyone | Comma-separated college domains members can register with |
| `RESEND_API_KEY`, `MAIL_FROM` | in production | Without a key, codes go to the console (development, test and staging only) |
| `HOST`, `PORT` | yes | `HOST=0.0.0.0` on a host; the platform sets `PORT` |
| `TRUST_PROXY` | behind a proxy | `1` on Render/Railway, so rate limits see the client IP, not the proxy's |
| `CORS_ORIGINS` | web clients only | Comma-separated origins; native apps don't need it |
| `RATE_LOGIN_PER_IP` | no | Default 300 per 15 minutes |
| `RATE_CODES_PER_IP` | no | Default 150 per 15 minutes (register, resend, forgot password) |
| `RATE_CODE_CHECKS_PER_IP` | no | Default 300 per 15 minutes |
| `REQUEST_EXPIRY_DAYS` | no | Default 30: open member requests expire, and their delivery OTP is cleared |
| `COLLECTION_CODE_MINUTES` | no | Default 15: how long a Collect now code is valid |
| `WAITING_TOO_LONG_DAYS` | no | Default 7: the admin dashboard's "waiting too long" line |
| `REMINDER_AFTER_DAYS` | no | Default 3: a linked parcel waiting this long gets an automatic reminder, then one every 3 days |
| `CONTRACT_PATH` | no | Only if `contracts/openapi.yaml` isn't shipped; by default the API finds it above its folder |

The per-IP limits are loose because the campus shares one public IP, and every attempt counts toward them,
successful or not. Per-email limits are fixed in code and strict: 10 logins and 5 code emails per 15 minutes, and
5 tries per code.

`SEED_PASSWORD` is for the local development fixture loader only.

## Health checks

- `GET /healthz`: the process is up.
- `GET /readyz`: the database answers; `503` when it doesn't. Render's health check points here. Neon suspends an
  idle database after a few minutes, so the first request after a quiet spell can take a moment longer.
