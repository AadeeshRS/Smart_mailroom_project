# Deployment

Status: started in Phase 2. The deploy, migration and rollback runbook is completed in Phase 1, once the shared
database and the Render/Railway account exist. Nothing below has been deployed yet.

## Requirements

### Memory: at least 1 GB RAM for the API

Passwords are hashed with scrypt (N = 2^17, r = 8), which needs **128 MiB per hash or check**. The API runs at most
two at a time (a semaphore in `api/src/core/security.ts`; extra logins wait about 0.3 s each), so scrypt alone can
use 256 MiB on top of Node and Prisma. A 512 MB instance (for example Render's free or Starter tier) can run out of
memory during a burst of logins. **Use an instance with at least 1 GB of RAM.**

### Email: Resend's free plan is too small for registration day

Every registration, resend, password reset and operator invite sends one email. Resend's free plan allows
**100 emails per day** (3,000 per month); paid plans have no daily limit
([Resend: what is Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing), checked
2026-11-14). A few hundred students registering at the start of term would hit the free cap within hours, and
everyone after that gets no code. **Production needs a paid Resend plan, or another provider such as Amazon SES or
Brevo** (that means a new sender in `api/src/modules/notifications/email.ts`).

## API environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | For a hosted database, the pooled URL with `sslmode=require` |
| `CREDENTIAL_PEPPER` | yes | At least 32 random bytes. Keep it stable and backed up: changing it invalidates pending codes |
| `NODE_ENV` | yes | `production` refuses to start without the email and domain variables below |
| `ALLOWED_EMAIL_DOMAINS` | in production | Comma-separated college domains members can register with |
| `RESEND_API_KEY`, `MAIL_FROM` | in production | Without a key, codes go to the console (development and test only) |
| `HOST`, `PORT` | yes | `HOST=0.0.0.0` on a host; the platform sets `PORT` |
| `TRUST_PROXY` | behind a proxy | `1` on Render/Railway, so rate limits see the client IP, not the proxy's |
| `CORS_ORIGINS` | web clients only | Comma-separated origins; native apps don't need it |
| `RATE_LOGIN_PER_IP` | no | Default 300 per 15 minutes |
| `RATE_CODES_PER_IP` | no | Default 150 per 15 minutes (register, resend, forgot password) |
| `RATE_CODE_CHECKS_PER_IP` | no | Default 300 per 15 minutes |
| `CONTRACT_PATH` | no | Only if `contracts/openapi.yaml` isn't shipped; by default the API finds it above its folder |

The per-IP limits are loose because the campus shares one public IP, and every attempt counts toward them,
successful or not. Per-email limits are fixed in code and strict: 10 logins and 5 code emails per 15 minutes, and
5 tries per code.

`SEED_PASSWORD` is for the development fixture loader only and isn't used in production.

## Health checks

- `GET /healthz`: the process is up.
- `GET /readyz`: the database answers; `503` when it doesn't. Point the platform's health check here.

## Build notes for Phase 1

- Plan §4.11: build `npm ci && npm run generate && npm run build`, pre-deploy `npm run migrate`, start `npm start`.
- If `NODE_ENV=production` is set at build time, `npm ci` skips devDependencies, and the build needs TypeScript and
  the Prisma CLI. Use `npm ci --include=dev` for the build step.
- First admin: `npm run create-admin -- <email> <name>` after a build. It emails a code; the admin sets a password
  through "Forgot password" in the app.
