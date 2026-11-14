# Smart Mailroom: Production Readiness Review and Plan

> **Superseded.** The implementation plan is now [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md), the source of truth. This review is kept for its F-numbered findings, which Phase 8 of that plan references. Its phases (A-G) and decisions (D1-D10) are no longer followed.

| | |
|---|---|
| Date | 2026-11-14 |
| Reviewed | `main` @ `2e5b179`, plus the uncommitted Expo SDK 58 upgrade on branch `expo-sdk-58` |
| Scope | `api/`, `contracts/`, `mobile/`, the Prisma migrations, and the Phase 0 design docs (`C:\se_project\docs\`) |
| Audience | The implementation session that will execute this plan |

## 0. How to use this document

- Work through the phases in order (section 5). Every task has an ID, the files it touches and an acceptance check. Finish a phase with all suites green before starting the next.
- **Stop and ask the user** before starting any task that depends on an open decision (section 4, `D1` to `D10`). Don't pick defaults for those.
- Ground rules that already hold in this repo. Keep them.
  - **Contract first.** Change `contracts/openapi.yaml`, then run `npm run generate && npm run validate && npm run check` in `contracts/`. Never hand-edit `contracts/generated/*` or `mobile/src/api/routes.generated.ts`.
  - **Invariants are tested.** `api/tests/postgres.test.ts` (24 tests) encodes the matching, idempotency, handover and recovery semantics. A refactor must keep it passing *unchanged*, unless the task explicitly changes that behaviour.
  - Database tests and the HTTP browser tests both reset `smart_mailroom_test`, so run them one after the other. Never point tests at `smart_mailroom_dev` or any production database.
  - Keep secrets in `.env` / `.env.test` (git-ignored). Never in `EXPO_PUBLIC_*`.
- Test commands: in `api/`, `npm run build && npm test`. In `mobile/`, `npm run typecheck && npm run lint && npm test`, then the HTTP browser tests: `node node_modules/playwright/cli.js test --config playwright.http.config.ts` after `node --env-file=.env.test --import tsx tests/export-http.ts` in `api/`.

## 1. Verdict

**Not production-ready.** The README says so itself ("synthetic development application, not production-ready").

The domain core is unusually strong. What's missing is everything around it:
- **No way to sign in in production.** The only login is the demo login, and it switches off when `NODE_ENV=production`.
- **No way to create accounts.** The only accounts are three hard-coded seed users.
- **Simulated notifications only.** Nothing is ever actually sent.
- **Every write rescans every table under one global lock.** That's fine for a demo, but it will slow down linearly, and stall every other user, once real volume builds up.
- **No logging and no deployment setup.** There are no logs, no health check, no container image, no CI, no backups and no HTTPS setup.
- **The mobile app can't be built for distribution.** It only runs in Expo Go: there's no EAS configuration, icons or real bundle ID.

## 2. What is already solid (keep it)

- **Contract-first API.** The OpenAPI 0.2.0 spec generates both the server routes and the mobile client types, and a check catches drift.
- **Correctness under retries.** Idempotency keys with request fingerprints, permanently replayable handover receipts, and client-side recovery of uncertain writes.
- **Database-enforced invariants.**
  - CHECK constraints on every status column.
  - Partial unique indexes: one active order per student/platform/reference, and one active credential per parcel.
  - Append-only audit, decision and handover tables.
  - Closed parcels are immutable.
- **Credential security.**
  - Login passwords hashed with scrypt.
  - Session tokens of 256 random bits, stored only as SHA-256.
  - OTP/QR values stored as HMAC with a separate pepper, and compared in constant time.
  - Five failed attempts lock a credential.
  - Rate limits on issuance, verification and login.
  - Other students' parcels return 404, not 403.
- **Request limits.** A 32 KB body limit, request and connection timeouts, and `Cache-Control: no-store` on every response.
- **Tests.** 24 PostgreSQL integration tests, 52 mobile unit tests, 3 HTTP/PostgreSQL browser tests, and a mock-mode browser suite.
- **Transactional outbox.** Notification rows and delivery attempts commit in the same transaction as the business change. Delivery results are deduplicated.

## 3. Findings

Severity: **P0** blocks any real deployment. **P1** is required for a credible launch. **P2** is an improvement or can come later.

### 3.1 Product scope and authentication

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| F1 | P0 | **No production sign-in.** The only login is `POST /v1/demo/sessions` (server account ID + one shared passcode). It is removed when `NODE_ENV=production`, so a production deployment can't authenticate anyone. | `api/src/config.ts:8`, `api/src/app.ts:32` |
| F2 | P0 | **No account lifecycle.** Users exist only through the seed script (3 hard-coded synthetic users). There's no student registration, staff provisioning, deactivation or profile editing. | `api/src/seed.ts:9-13` |
| F3 | P1 | **Only two roles, STUDENT and STAFF.** The Phase 0 design needs SECURITY (handover + read records) and ADMIN (user management, global audit, disputes). Today a guard would have to be STAFF, which also grants intake and reconciliation. | `api/prisma/migrations/202610280002_invariants/migration.sql:3`, `api/src/context.ts:7-8`, `C:\se_project\docs\API_CONTRACT.md` §2 and §4 |
| F4 | P1 | **Notifications are simulated.** Every delivery attempt is created with `simulated: true`, and the worker just marks it ACCEPTED. No email or push is sent, so students only learn about an arrival by opening the app. | `api/src/matching.ts:12` (`notify`), `api/src/outbox.ts:17-21` |
| F5 | P1 | **Counter workflow needs a parcel lookup first.** Verification is `POST /parcels/{parcelId}/verifications`, so staff must find the parcel before scanning the student's QR. The QR already carries `credentialRef`, so the server could find the parcel from it. With a queue at the counter this is slow. | `contracts/openapi.yaml` (`/parcels/{parcelId}/verifications`), `mobile/src/screens/collection.tsx` |
| F6 | P2 | **Planned use cases are missing.** No reminders for uncollected parcels, no staff dashboard counts, no unclaimed/returned parcel lifecycle, and no audit-log viewer (Phase 0 UC15-18, UC27-30). | Phase 0 `MASTER_PLAN.md` §5 |

### 3.2 Scalability and performance

The design load from Phase 0 is "a few hundred parcels a day", which comes to roughly 10k+ parcels per semester.

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| F7 | P0 | **Every write re-runs matching over every row in the database.** `recheck()` runs after create order, add tracking, cancel order, intake and reconcile. It loads all orders and all parcels, each parcel with its full audit history, and recomputes a fingerprint for every open parcel against every order and every other parcel (roughly O(P·(O+P))). Then it issues one `COUNT` and one `UPDATE` for **every** non-cancelled order. Writes slow down in proportion to everything ever stored, and each write rewrites thousands of rows. | `api/src/matching.ts:60-86` |
| F8 | P0 | **Every request, reads included, is a serialised write transaction.** Each call takes the one global advisory lock, deletes expired snapshot and idempotency rows, and runs `establishEvidenceBaselines` (a legacy-migration scan). One slow write (F7) blocks every user; the others wait up to 15 s and then fail with 503. | `api/src/db.ts:14`, `api/src/backend.ts:22-25`, `api/src/backend.ts:44`, `api/src/matching.ts:42` |
| F9 | P1 | **Lists are built in memory.** `listParcels` for staff loads every parcel ever received, with its audits. `listOrders`, `getReview` and `listReceipts` load whole tables and filter, sort and search in JavaScript. Pagination snapshots store the full ID list as JSON. | `api/src/backend.ts:45`, `:57-62` (listOrders), `:86-89` (listParcels), `:102-106` (getReview), `:144-147` (listReceipts), `api/src/context.ts` (`page`) |
| F10 | P2 | **Foreign keys without indexes.** `AuditEvent.parcelId`, `Decision.parcelId`, `Session.userId` and `Parcel.orderId` have none, and there's no index serving staff parcel lists (`status, receivedAt, id`). | `api/prisma/schema.prisma` |

### 3.3 Operations and observability

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| F11 | P0 | **Nothing is logged.** The Fastify logger is off, and the error handler turns every unexpected exception into `503 PERSISTENCE, retryable: true` **without logging it**. Bugs in production would be invisible, and clients would be told to retry them. | `api/src/app.ts:14`, `api/src/app.ts:21-25` |
| F12 | P0 | **No deployment setup.** There's no Dockerfile, no compose file, no CI, no HTTPS termination, no health or readiness endpoint and no staging environment. The documented database is a trust-auth cluster in `%TEMP%`. | repo tree, `README.md` |
| F13 | P1 | **Rate limits break behind a proxy.** `trustProxy` isn't set, so behind a reverse proxy `request.ip` is the proxy's address. The login limit of 20/min per IP would then be one limit shared by all users. | `api/src/app.ts:14`, `:38` |
| F14 | P1 | **No backups and no production migration process.** No backup or restore procedure exists, and there's no documented way to run migrations against a production database. | not present |
| F15 | P1 | **Some tables grow forever.** Expired `Session` and `RateWindow` rows are only ever deleted by the dev reset. | `api/src/seed.ts:28`; the only request-time cleanup is `backend.ts:24-25` |
| F16 | P2 | **Assumes a single API instance.** The background worker runs inside every API process on a 1 s timer, and the secrets used to replay a credential issuance live in that process's memory. That's fine for one instance, but should be documented before anyone scales out. | `api/src/server.ts:10`, `api/src/credentials.ts:11` |
| F17 | P1 | **The contract file is read at runtime.** The API reads `../contracts/openapi.yaml` relative to its working directory when it starts, so a deployment must ship that file or set `CONTRACT_PATH`. | `api/src/contract.ts:10` |

### 3.4 Security

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| F18 | P1 | **The append-only protection can be switched off by the app itself.** Any database session can run `SET mailroom.reset = 'enabled'` and then modify or delete audit rows, handovers, decisions and closed parcels, and the app's own database user can do this. Production needs no reset bypass. | `api/prisma/migrations/202610280002_invariants/migration.sql:16`, `:26` |
| F19 | P1 | **The app connects as the database owner.** Every documented setup uses the owner/superuser. There's no split between a migration role and a runtime role with data-only permissions. | `README.md`, `api/.env.example` |
| F20 | P1 | **Client retry keys can repeat.** They are `demo-${Date.now()}-${counter}`, and the counter resets when the app restarts, so the same user can produce the same key twice. A repeat with an identical body silently returns the old result. | `mobile/src/runtime.tsx:84` |
| F21 | P2 | **Unknown errors are marked retryable.** The `retryable: true` flag invites clients to retry errors that aren't temporary. Fix this together with F11. | `api/src/app.ts:22` |
| F22 | P2 | **No security headers or HSTS.** CORS defaults to localhost; production needs the real web origin. | `api/src/app.ts:15`, `api/src/config.ts:9` |

### 3.5 Mobile app

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| F23 | P0 | **The app can't be built for distribution.** There's no `eas.json`, no icon, adaptive icon or splash screen, the bundle ID is the placeholder `edu.demo.smartmailroom`, and there's no version code or build number. It only runs inside Expo Go. | `mobile/app.json` |
| F24 | P1 | **Users are signed out constantly.** The session token exists only in memory, with a fixed 30-minute server lifetime and no refresh, so restarting the app or waiting 30 minutes forces a new login. | `mobile/src/api/http.ts:10`, `api/src/backend.ts:35` (`1_800_000` ms) |
| F25 | P1 | **Demo-only UI everywhere.** Login by account ID, `DEMO_ACCOUNTS`, `DemoBanner`, "demonstration" wording, the staff "Reset demo data" button, and the mock adapter (40 KB) bundled into every build. | `mobile/src/api/service.ts:26`, `mobile/src/screens/auth.tsx`, `mobile/src/runtime.tsx:15` |
| F26 | P1 | **Raw error codes are shown to users** as `"message (CODE)"`. | `mobile/src/runtime.tsx` (`handleError`) |
| F27 | P2 | **Little accessibility support.** Accessibility labels exist only in the shared UI components (10 occurrences in `ui.tsx`); the screen files have about 1 in total. Not tested with a screen reader. | `mobile/src/screens/*.tsx` |
| F28 | P2 | **No crash reporting and no over-the-air update policy.** | `mobile/package.json` |
| F29 | P2 | **Personal data stored unencrypted on the device.** Pending intake and review requests, which contain label data (emails, student numbers), stay in AsyncStorage unencrypted for up to 24 h. Acceptable on an encrypted device, but document it. | `mobile/src/api/writeRecovery.ts` |
| F30 | P1 | **Physical devices are untested.** Scanning a real label, scanning the collection QR and running natively are all marked NOT TESTED in the README. | `README.md` "Final device demonstration" |

### 3.6 Code quality, process and documentation

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| F31 | P1 | **Extremely long lines.** 53 lines over 300 characters in the mobile screens, the longest 1,577 characters; the backend is similar. That's hard to review or maintain as a team, and diffs are unreadable. No formatter is configured. | `mobile/src/screens/*.tsx`, `api/src/*.ts` |
| F32 | P1 | **No CI.** The test suites exist, but nothing runs them on pushes or PRs. | repo tree |
| F33 | P1 | **Docs don't match the code.** The README is a review log, not developer documentation. The Phase 0 design describes FastAPI + a Next.js PWA + email-code login; what was built is Fastify + Expo + demo login. There's no decision record reconciling the two. | `README.md`, `C:\se_project\docs\ARCHITECTURE.md` §1-2 |
| F34 | P1 | **The SDK 58 upgrade isn't committed.** It sits uncommitted on `expo-sdk-58`, and the README still says SDK 55 and shows the old advisory table. | `git status` |
| F35 | P2 | **One big backend class.** `backend.ts` holds every handler in one class; new admin and security endpoints should go in their own modules instead of growing it. | `api/src/backend.ts` |

### 3.7 Data protection and compliance

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| F36 | P1 | **No privacy policy.** The app handles personal data (names, emails, student numbers, label contents) with no privacy notice, retention policy or erasure approach. India's DPDP Act 2023 applies to a college deployment. Note that append-only audit records conflict with erasure, so plan to pseudonymise instead. | schema, Phase 0 `ARCHITECTURE.md` §5.6 |
| F37 | P2 | **8 moderate npm advisories remain,** all `minimatch` in lint/build tooling. Development only. | `npm audit` in `mobile/` |

## 4. Decisions needed from the team

Ask the user for each of these before starting the dependent task.

| ID | Decision | Options (recommendation first) | Blocks |
|---|---|---|---|
| D1 | Sign-in method | **Email one-time code limited to the college email domain** (already in the Phase 0 design; no college IT needed) · Google Workspace OIDC (only if the college uses Google) · both | C1-C8 |
| D2 | Email provider | Resend · AWS SES · Brevo · college SMTP | C3, D-phase |
| D3 | Push notifications | **Yes, via Expo push** (needs an EAS project and FCM credentials) · email only | D3 |
| D4 | Hosting | **One VM with Docker Compose + Caddy (automatic HTTPS) + Postgres**, plus nightly off-site backups · a PaaS (Render/Railway/Fly) with managed Postgres (Neon/Supabase) | F-phase |
| D5 | Mobile distribution | **EAS internal APK or Play internal testing** · public stores (iOS needs an Apple developer account) | E1, E8 |
| D6 | Staff desk on web | **Yes**: serve the Expo web export over HTTPS for the counter PC (the camera needs HTTPS) · app only | E-phase, F2 |
| D7 | App identity | App name, organisation, bundle ID / package, icon | E1 |
| D8 | Retention periods | Closed parcels, audit, notifications, sessions, login codes | G1 |
| D9 | Lifting the contract freeze | The README freezes OpenAPI 0.2.0 behind reviewer approval. C, D, E5 and B7 need **0.3.0**. Who approves? | B7, C, D, E5 |
| D10 | Error tracking | Sentry free tier · logs only | E7 |

## 5. Implementation plan

Sizes: **S** < 1 day, **M** 1-3 days, **L** 3+ days. "Done" for each phase means its acceptance checks pass and every existing suite is green.

### Phase A: Baseline and hygiene (S)

No behaviour changes.

| ID | Task | Acceptance |
|---|---|---|
| A1 | Commit the SDK 58 upgrade on `expo-sdk-58`. Update the README's version numbers (Expo 58.0.25, React Native 0.88.1, React 19.3.0, TypeScript 6.0) and replace the advisory table (8 moderate, `minimatch`, dev only). Merge to `main`. | Mobile typecheck, lint and tests are green; the HTTP browser tests pass (they did on 2026-11-14) |
| A2 | Add Prettier as a dev dependency in `api/` and `mobile/` (`printWidth: 120`) with `format` and `format:check` scripts. Format everything in **one formatting-only commit**. Don't hand-edit generated files. | `git diff --stat` shows only whitespace/line changes; all suites green |
| A3 | GitHub Actions CI with three jobs. **contracts:** `generate`, `validate`, `check`. **api:** `postgres:17` service, `migrate deploy`, `build`, `test`, `npm audit --omit=dev`. **mobile:** `typecheck`, `lint`, `test`, `format:check`. Run the HTTP browser tests as a separate job, triggered manually or nightly. | CI runs green on a PR |

### Phase B: Backend scale and operability (M-L)

This phase is P0. Everything except B7 keeps the contract unchanged.

| ID | Task | Acceptance |
|---|---|---|
| B1 | Turn on the Fastify logger (pino ships with Fastify, so no new dependency). Redact `req.headers.authorization`, `passcode`, `otp`, `qr.token` and `token`. In the error handler, log unexpected errors with their `requestId` and the stack trace. Send an `x-request-id` header on every response. Set `retryable: false` for unexpected errors (fixes F21) while keeping the `PERSISTENCE` code. | A test triggers an unexpected error and finds one log line with the requestId; a test scans the log output from the login/issue/verify flows and finds no secrets |
| B2 | Add `GET /healthz` (process alive) and `GET /readyz` (`SELECT 1`) outside `/v1`, unauthenticated and absent from the contract. | Both return 200; `/readyz` returns 503 when the database is down |
| B3 | Add a `TRUST_PROXY` environment variable (hop count or CIDR) and pass it to Fastify's `trustProxy`. | Test: with `X-Forwarded-For` and `TRUST_PROXY=1`, the rate-limit key uses the client IP |
| B4 | Move cleanup out of the request path. Delete expired snapshot, idempotency, **session** and **rate-window** rows from the existing background worker, once a minute. Take `establishEvidenceBaselines` out of `execute()`: run it once as a script (`npm run migrate:baselines`), confirm no legacy rows are left, then delete the code. | Requests issue no `DELETE`; tables stop growing; the 24 PostgreSQL tests pass |
| B5 | Run read-only operations (`get*`, `list*`) without the global advisory lock, as `REPEATABLE READ READ ONLY` transactions. **Keep the global lock for writes**: there are a few hundred a day, and that lock is what the correctness tests rely on. | Reads no longer queue behind writes; all tests pass |
| B6 | Replace the full-table `recheck()` with a **scoped** recheck. The affected set is the parcels and orders that share an identifier `(kind, namespace, value)` with the changed order or parcel, plus their fingerprint peers, all found with indexed queries. Update order status only for the orders that were touched. Load audit rows only where the response needs them (staff detail), not in `parcelInclude` for lists and matching. | The 24 PostgreSQL tests pass **unchanged**; B9's targets are met |
| B7 | **Needs D9.** Filter, sort and search lists in the database, with keyset cursors on `(receivedAt, id)` / `(createdAt, id)` in place of full-ID-list snapshots. This changes the frozen "membership freeze" pagination behaviour, so update the contract text and the related tests in the same change. If D9 is refused, keep snapshots but build them from a database query capped at 1,000 IDs. | Staff list p95 within the B9 target; the pagination tests are updated and green |
| B8 | Index migration: `AuditEvent(parcelId, at)`, `Decision(parcelId)`, `Session(userId)`, `Session(expiresAt)`, `Parcel(orderId)`, `Parcel(status, receivedAt, id)`, `RateWindow(expiresAt)`. | `migrate deploy` is clean; EXPLAIN of the hot queries shows index scans |
| B9 | Performance check: a Node script using plain `fetch`, no new dependency, that seeds `smart_mailroom_test` with 20k parcels, 10k orders and 2k students, then drives 20 concurrent clients. **Targets:** p95 under 300 ms for reads and under 800 ms for intake, create order, issue, verify and confirm. | The script prints p50/p95 and exits non-zero if a target is missed; it runs in the nightly CI job |

### Phase C: Real authentication and roles (L)

Needs D1 and D9. The design source is Phase 0 `ARCHITECTURE.md` §5.1-5.2 and `API_CONTRACT.md` §2-4.

| ID | Task | Acceptance |
|---|---|---|
| C1 | Contract 0.3.0. **Auth:** `POST /auth/codes` (request a code by email, always returns 202) and `POST /auth/sessions` (exchange the code for a session); keep the existing session read and logout. **Roles:** the enum gains `SECURITY` and `ADMIN`. **Admin endpoints:** `GET/POST /admin/users` and `PATCH /admin/users/{userId}` (role, active flag, name, student number), with the Phase 0 lockout guards (an admin can't demote themselves; the last admin can't be removed). | Contract `validate` and `check` pass; client and server regenerated |
| C2 | Migration: the role CHECK adds `SECURITY` and `ADMIN`; add `User.active`; add a `LoginCode` table (email HMAC, code HMAC, attempts, expiry, consumed); new real users get `synthetic = false`; store emails normalised to lowercase. | Migration applies to a copy of the dev database |
| C3 | Login codes. Six digits from `randomInt`, stored as HMAC with the pepper (reuse `secretDigest`), valid 10 minutes, 5 attempts, only the latest code valid. Rate limit 5 requests per email per 15 minutes, plus a per-IP limit. Who can sign in: an existing **active** user, or an email in `ALLOWED_EMAIL_DOMAINS`, which creates a STUDENT on first sign-in followed by a profile step to capture the student number. Return the same response whether or not the email exists. Sending uses the D2 provider, or the console in development and test only. | Tests: happy path, wrong code ×5 locks, an expired code fails, no account enumeration, a non-college domain is refused |
| C4 | Replace `staff(c)` / `student(c)` with a permission map: `SELF_SERVICE` STUDENT; `MAILROOM_OPS` STAFF; `HANDOVER` STAFF and SECURITY; `RECORDS_READ` STAFF, SECURITY and ADMIN; `ADMINISTER` ADMIN. Add a **route × role matrix test** that walks every registered route and fails if a route is missing from the expected table. | The matrix test passes; a guard gets 403 on intake and 2xx on verify/confirm |
| C5 | A production-safe admin bootstrap: `npm run create-admin -- <email> <name>`, which refuses to run if that email already exists as a non-admin. This doesn't depend on `DEMO_ENABLED`. | Works with `NODE_ENV=production` |
| C6 | Sessions: 7-day sliding expiry (the Phase 0 default). Logout revokes the session; deactivating a user revokes all of their sessions. | Tests |
| C7 | Mobile. **Login:** email, then code. **Session storage:** keep the token in `expo-secure-store` (`npx expo install expo-secure-store`) and restore it on launch with `GET /session`. **Routing:** STUDENT goes to student tabs, STAFF to staff tabs, SECURITY to a collection-only view (verify and confirm, read records), and ADMIN to new screens for users (list, invite, change role, deactivate). | The app survives a restart while still signed in; each role sees only its own screens |
| C8 | Keep the demo login for development and test only (the server gate already exists), and remove the demo login UI from production builds (see E2). | A production build doesn't contain the string "Demonstration login" |

### Phase D: Real notifications (M)

Needs D2 and D3.

| ID | Task | Acceptance |
|---|---|---|
| D-1 | Email adapter for login codes (sent directly, with retry) and for arrival, hold and collection notifications (sent through the outbox). | Staging: an arrival email arrives within 1 minute |
| D-2 | Outbox worker. Process attempts with `simulated = false` through the provider adapter and record results through the existing `deliveryResult()`. Retry with exponential backoff and mark the attempt FAILED after N tries. Create one attempt per channel (EMAIL, PUSH). Keep the simulated path for development. | A provider outage is retried, then shows FAILED; no duplicate sends |
| D-3 | Push. Add `POST /devices` (register an Expo push token, scoped to the user and revoked on logout), use `expo-notifications` in the app, ask for permission after login, and deep-link to the parcel. | A phone gets a push and tapping it opens the parcel |
| D-4 | Reminder job: uncollected parcels older than `REMINDER_AFTER_DAYS` get a notification, with an idempotent `eventKey`. | Test with an injected clock |
| D-5 | Production guard: refuse to start with `NODE_ENV=production` when the email provider is `console`, the pepper is a placeholder, or `ALLOWED_EMAIL_DOMAINS` is empty (Phase 0 §5.5). | Startup test |

### Phase E: Mobile production readiness (M)

Needs D5, D6, D7 and D10.

| ID | Task | Acceptance |
|---|---|---|
| E1 | `eas.json` with `development`, `preview` and `production` profiles. In `app.json`: the real name and bundle ID/package (D7), icon, adaptive icon, splash, `version`, `android.versionCode` / `ios.buildNumber`. If OTA updates are wanted, add `expo-updates` with a `runtimeVersion` policy. | An EAS preview build installs on a physical Android phone |
| E2 | Remove the demo UI from production builds: `DemoBanner`, `DEMO_ACCOUNTS`, the reset button and the mock controls, controlled by an `EXPO_PUBLIC_APP_ENV=production` variable. Load `api/mock.ts` with a conditional `require` so it isn't bundled in HTTP builds. | A grep of the production bundle finds no "demo" strings or mock fixture names |
| E3 | Friendly error messages: map each `ErrorCode` to plain wording, and show the `requestId` only in a small "details" line. | Unit test: every code in the contract has a message |
| E4 | Generate retry keys with `randomUUID()` from `expo-crypto` (`npx expo install expo-crypto`), replacing `mobile/src/runtime.tsx:84`. | Keys are unique across restarts |
| E5 | **Needs D9.** Scan-first counter flow. Staff home gets "Scan collection QR", which calls a new `POST /verifications` (QR only; the server finds the parcel from `credentialRef`), then the existing confirm step. OTP entry gets a student search first. | A counter handover takes one scan plus one confirm |
| E6 | Accessibility: labels and roles on every touchable element, alternative text for QR codes, contrast of at least 4.5:1, support for large system fonts, and a TalkBack walkthrough of login, inbox, collection and staff intake. | Checklist recorded in `docs/` |
| E7 | Crash reporting, if D10 says yes. | A test crash shows up in the dashboard |
| E8 | Physical device run (closes F30): scan a real label, scan the collection QR, complete a handover on Android (and on iOS if D5 includes it). Record the device, OS, build and results. | A results table in `docs/DEVICE_TEST.md` |

### Phase F: Deployment and data protection (M)

Needs D4. This phase can run in parallel with C, D and E once B is done.

| ID | Task | Acceptance |
|---|---|---|
| F-1 | `api/Dockerfile`: multi-stage, based on `node:24-alpine`, shipping `contracts/openapi.yaml` (or setting `CONTRACT_PATH`), running as a non-root user. Migrations run as a separate one-off command using the **owner** role. | The image builds and `/readyz` returns 200 under compose |
| F-2 | `deploy/docker-compose.prod.yml` with Caddy (automatic HTTPS, HSTS and security headers), the API, and Postgres or a managed database. Caddy also serves the staff web export if D6 says yes. | HTTPS works end to end on the staging domain |
| F-3 | Database roles: `mailroom_owner` for migrations and `mailroom_app` for runtime (`SELECT/INSERT/UPDATE/DELETE` on the app's tables only; no DDL, not the owner). **Remove the reset bypass in production.** Make the triggers honour `mailroom.reset` only when a row in a settings table, writable only by the owner role, allows it, and leave that row absent in production. | Test: as `mailroom_app`, `SET mailroom.reset='enabled'` followed by an audit update still fails |
| F-4 | Secrets: an `.env` readable only by its owner on the host, or the platform's secret store. Document backing up `CREDENTIAL_PEPPER`: losing it invalidates only the credentials active at that moment. | `docs/DEPLOYMENT.md` section |
| F-5 | Backups: a nightly `pg_dump` to off-site storage kept for 14-30 days, or managed point-in-time recovery. Do **one restore drill** and record it. | Drill log in `docs/DEPLOYMENT.md` |
| F-6 | A staging environment matching production. A deploy runbook with rollback steps. A migration policy: expand, then contract, with no destructive migration in the same release as the code that depends on it. | A fresh server goes live by following the runbook alone |
| F-7 | Monitoring: an uptime check on `/readyz`, a log retention period, and an alert on the 5xx rate. | An alert fires during a deliberate outage |

### Phase G: Compliance and documentation (S-M)

Needs D8.

| ID | Task | Acceptance |
|---|---|---|
| G1 | Privacy notice in the app, acknowledged at first sign-in. A retention job implementing D8 that **pseudonymises** student fields on old closed records instead of deleting them, so the audit trail keeps its integrity. | Job tested with an injected clock |
| G2 | Rewrite the README as developer documentation (what it is, quick start, architecture, scripts, environment variables). Move the review and closeout history to `docs/HISTORY.md`. | A new developer runs the app using only the README |
| G3 | A decision record reconciling the Phase 0 design (FastAPI / Next.js) with the stack actually built (Fastify / Expo). Update requirements traceability to show which use cases are implemented and which are deferred. | `docs/adr/0001-stack.md` |
| G4 | Final security pass: route × role matrix, `npm audit` for all three packages, a secrets scan of the git history, and a review of every `ponytail:` comment and TODO. | Report in `docs/SECURITY_REVIEW.md` |

## 6. Deferred (not in this plan)

Add these only if the team asks:
- SMS (in India this needs DLT registration)
- label OCR (today only the barcode/QR text is decoded)
- Google OIDC, unless D1 picks it
- running more than one API instance (would need the worker split out and a shared credential cache)
- a full disputes workflow beyond the current holds
- a lifecycle for returned or unclaimed parcels

## 7. Definition of production-ready

- [ ] Real users can sign in with `NODE_ENV=production`; demo login and reset are unreachable (F1, F2, C)
- [ ] All four roles are enforced and covered by the route × role matrix test (F3, C4)
- [ ] Arrival notifications reach students by email and/or push (F4, D)
- [ ] Performance targets are met on the 20k-parcel dataset; reads don't wait behind writes (F7-F9, B)
- [ ] Errors are logged with a request ID and no secrets; `/readyz` is monitored (F11, B1-B2, F-7)
- [ ] Deployed over HTTPS from a container image using the runbook; backups and a restore drill are done (F12, F14, F)
- [ ] The app runs with a least-privilege database role and no audit bypass (F18, F19, F-3)
- [ ] An installable mobile build has no demo UI and keeps users signed in across restarts (F23-F26, C7, E)
- [ ] Tested on a physical device: label scan, QR scan, handover (F30, E8)
- [ ] CI is green on `main`; code is formatted; the README and decision record are current (F31-F34, A, G)
- [ ] A privacy notice and retention job are live (F36, G1)
