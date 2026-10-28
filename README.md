# Smart Mailroom

Independent reviewer approval authorizes backend implementation and integration from frontend baseline `2bc1945a61334dc179eeb6ee73b621b1c08b3cba`. The frozen OpenAPI contract is version **0.2.0**; its reviewed SHA-256 was `21C80EFA5840CF813326DB5E5416FEDE9767860435D76C4CB57155A22BC5A653`. Only the authorized approval labels and intake-normalization wording changed. Methods, schemas, projections and business semantics remain frozen. This is a synthetic development application, **not production-ready**. No college SSO, real notifications, shopping or courier integration exists.

`api/` is one Fastify/TypeScript/Prisma application with PostgreSQL. `mobile/` is the Expo Router app with explicit mock/HTTP adapters. `contracts/openapi.yaml` is canonical; declarations and HTTP route metadata are generated reproducibly. Supplied references and local test artifacts remain outside Git.

Use Node **24 LTS** (verified 24.22.1), npm 11 and PostgreSQL 17. Backend versions: Fastify 5.12.7, Prisma/client/PG adapter 7.10.1, pg 8.16.3, TypeScript 5.9.3. Prisma 7 is a stable supported line; the available Prisma 8 release candidate was not selected. See [Prisma requirements](https://www.prisma.io/docs/orm/reference/system-requirements), [PostgreSQL adapter](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql) and [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/). Expo SDK 55 retains React 19.2.0 / React Native 0.83.10 / Router 55.0.18.

## Setup and run

Create **dedicated** `smart_mailroom_dev` and `smart_mailroom_test` databases. Never use unrelated databases. Development and tests must have different URLs. Reset/seed refuse other database names and reset refuses any non-synthetic user. No table is shared with another application.

For the installed Windows PostgreSQL binaries, an optional isolated local-only cluster can be created without touching the existing PostgreSQL service:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$mailroomData = Join-Path $env:TEMP 'smart-mailroom-pg17'
# Run initdb only once, against this new directory. Trust is for this loopback-only development cluster.
& "$pgBin\initdb.exe" -D $mailroomData -U mailroom_admin -A trust --encoding=UTF8 --locale=C
& "$pgBin\pg_ctl.exe" -D $mailroomData -l "$env:TEMP\smart-mailroom-pg17.log" -o '-p 55432 -h 127.0.0.1' -w start
& "$pgBin\createdb.exe" -h 127.0.0.1 -p 55432 -U mailroom_admin smart_mailroom_dev
& "$pgBin\createdb.exe" -h 127.0.0.1 -p 55432 -U mailroom_admin smart_mailroom_test
```

From the repository root:

```powershell
cd contracts
npm.cmd ci --cache "$env:TEMP\smart-mailroom-npm-cache"
npm.cmd run generate
npm.cmd run validate
npm.cmd run check
cd ../api
npm.cmd ci --cache "$env:TEMP\smart-mailroom-npm-cache"
Copy-Item .env.example .env
# Edit .env: DATABASE_URL, synthetic DEMO_PASSCODE, strong persistent CREDENTIAL_PEPPER.
# The optional cluster URL is postgresql://mailroom_admin@127.0.0.1:55432/smart_mailroom_dev
# Generate a pepper locally: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm.cmd run generate
npm.cmd run migrate
npm.cmd run seed
npm.cmd run build
npm.cmd start
```

Keep `.env` local. Set `NODE_ENV=development`, `DEMO_ENABLED=true`, and a fictitious passcode of at least 12 characters. Seeds print **random server account IDs** for Asha Rao (DEMO1001), Neel Shah (DEMO1002), and Mira Sen (staff); identities survive reseeding and reset. Existing password hashes are preserved. Enter the passcode used at first seed. Production environments always disable demo login/reset, even if `DEMO_ENABLED=true`.

In another terminal:

```powershell
cd mobile
npm.cmd ci --cache "$env:TEMP\smart-mailroom-npm-cache"
Copy-Item .env.example .env
# Set EXPO_PUBLIC_API_MODE=http and EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000/v1
# Optionally replace the three account-ID placeholders with actual seed output.
npm.cmd start -- --clear
```

Without configured account choices, enter a seeded server account ID manually. Roles come from the server, never a client role selector. HTTP mode shows a persistent HTTP/PostgreSQL demo banner and hides simulated-offline/response-loss controls. Requests use bearer sessions in volatile memory, no-store fetches, bounded timeouts and typed errors. HTTP failures **never** fall back to mock fixtures. Sessions expire in 30 minutes and logout revokes them on the server.

Use `EXPO_PUBLIC_API_MODE=mock` for the independent local demo (public mock passcode `mailroom-demo`). Clear Expo's bundler cache when switching modes because public configuration is compiled into the bundle. Account IDs and API URLs are public configuration; never place secrets in `EXPO_PUBLIC_*`.

API URL examples: web/iOS simulator `http://127.0.0.1:3000/v1`; Android emulator `http://10.0.2.2:3000/v1`; physical device `http://<development-computer-LAN-IP>:3000/v1`. For LAN testing explicitly bind `HOST=0.0.0.0`, configure the web CORS origin/firewall, and use a development network. HTTPS is required for deployment; browser camera APIs also require a secure context. These examples are not device-test evidence.

## Persistence and invariants

Every operation takes a shared PostgreSQL **transaction advisory lock**, using READ COMMITTED. This intentionally serializes domain operations across API processes for a small mailroom, including concurrent claims/intake/reconciliation/issuance/confirmation. Constraints independently enforce one active order per student/platform/reference, unique physical intake reference, one ACTIVE credential per parcel, one permanent handover per parcel and one result per principal/operation/key. Deadlock/serialization conflicts retry at most three attempts. Transaction tests assert rollback of the handover, credential/verification consumption, parcel closure, audit, outbox and idempotency together. This favors simple correctness over high throughput; direct database writers must not bypass the application locking protocol.

Audit/decision/handover rows are append-only; a database trigger prevents modification of CLOSED parcels. Foreign keys restrict deletion. Explicit development reset is the only bypass, executes in a transaction, preserves provisioned users, and deletes only these dedicated synthetic project tables. Database administrator privileges are not an application authorization mechanism; production least-privilege deployment remains a separate review concern.

Matching uses identifier kind, approved namespace and namespace-specific normalized value. Original values are retained internally. Unique matching also requires independent authoritative profile evidence and no contradictions. Tracking reuse preserves new intake unassigned and holds affected uncollected assignments; merchant-order split shipments remain separate eligible parcels. Reconciliation records checklist, reason and an evidence fingerprint; new relevant evidence reopens review and invalidates credentials. Closed history cannot transfer.

Passcodes use salted **scrypt N=131072/r=8/p=1** ([OWASP parameters](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)); legacy demo hashes upgrade after successful login. Bearer tokens contain 256 random bits; the database stores SHA-256 digests. Operational IDs contain at least 128 random bits. OTP/QR digests use HMAC-SHA-256 with a separate persistent server pepper and credential-specific domain separation, protecting six-digit OTPs against database-only offline enumeration. Ordinary database records and logs never contain OTPs, QR tokens or bearer secrets.

Credentials last ten minutes; explicit replacement revokes old OTP/QR presentations. Five failed OTP attempts invalidate the current credential. Issuance is limited to six fresh requests per minute per student/parcel; verification to twenty attempts per minute per staff/parcel; demo login to twenty attempts per minute per source IP. Quota validation errors use existing frozen codes with `retryable=true` and a one-minute retry instruction. The five-failure OTP response retains its frozen 429 ATTEMPTS_EXCEEDED semantics. Verification binds current credential, revision and staff session for at most two minutes and never completes collection.

Successful ordinary write results retain principal/operation/key fingerprints for 24 hours. Handover results remain with permanent receipts; same-key replay runs before expiry/lifecycle checks and survives API restart and staff logout/login. Issuance stores only non-secret retry metadata for 24 hours; original response replay is available only from the current session's volatile, unexpired cache. Losing that cache returns ISSUANCE_RETRY_UNAVAILABLE; recovery explicitly replaces with a new key. No plaintext database replay envelope exists.

The client saves original uncertain registration/intake/reconciliation requests and confirmation requests, scoped by backend URL and authenticated account. The overview exposes recovery actions. Confirmation recovery persists no OTP/QR/session token; it never automatically invents a new key. Saved ordinary intake/review requests may contain synthetic label evidence and are removed after recovery. Local storage is not a server authorization boundary.

Pagination stores 15-minute server snapshots: membership/order freeze, concurrent inserts wait for a new first page, each page rechecks current ownership and returns current projections. Candidate pages are searchable, default 20/max 50. Common student projections explicitly exclude internal evidence, staff actors and review reasons, including search side channels.

Arrival/collection notifications and PENDING outbox attempts commit in the business transaction. A separate deterministic worker marks simulated attempts ACCEPTED; it sends nothing and never claims DELIVERED. Delivery-result processing deduplicates attempt/event IDs and rejects stale/terminal updates. Inbox availability/readAt remain independent of delivery status. No student/staff endpoint can submit provider results.

## Verification

Create local `api/.env.test` using `.env.example`, with `NODE_ENV=test`, `DEMO_ENABLED=true`, a test pepper/passcode, and the **smart_mailroom_test** URL. Then:

```powershell
cd api
node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy
npm.cmd run build
npm.cmd test
npm.cmd audit
# Builds a separate HTTP web export using the test database's actual seeded account IDs.
node --env-file=.env.test --import tsx tests/export-http.ts
cd ../mobile
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
node node_modules/playwright/cli.js install chromium
node node_modules/playwright/cli.js test --config playwright.http.config.ts
# Separate local mock regression suite; clear configuration cache before exporting.
$env:EXPO_PUBLIC_API_MODE='mock'
node node_modules/expo/bin/cli export --clear --platform web --max-workers 2
node node_modules/playwright/cli.js test --config playwright.config.ts
node node_modules/expo/bin/cli export --platform android --platform ios --max-workers 2 --output-dir dist/native
npx.cmd expo install --check
```

Run database tests and HTTP browser tests sequentially: both intentionally reset the isolated test dataset. The HTTP browser supervisor binds loopback ports 3100/3101 and web port 8082; its restart control is test-only and absent from the API application. The recovery browser test waits past real verification expiry, restarts the actual API child process, reloads the browser, and asserts one original PostgreSQL receipt/key. Mock browser tests use port 8081. Logs, traces, screenshots and exports are ignored. Physical camera decoding and native device execution remain **NOT TESTED**; exports validate JavaScript bundling only. Real SSO, real providers, production deployment and security/scale review remain outside this task.

Backend `npm audit` currently reports **zero advisories**. The three frontend advisories remain accepted risks **for local development only**, not resolved or production-approved: 11 affected-package findings (3 high, 3 moderate, 5 low).

| Advisory/path | Reachability and remaining fix limitation |
| --- | --- |
| [decode-uri-component 0.2.2](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), Router 55.0.18 → query-string 7.1.3 | App runtime URL/query handling. Fix 0.5.0+ has an incompatible export for this consumer; tested 0.5.1 produces TypeError. Needs upstream backport or reviewed SDK migration. |
| [Zod 3.25.76](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), Expo CLI 55.0.37 | DevTools/MCP plugin-input parsing in development/build tooling. Fix 4.6.6 is outside the supported 3.x range; no compatible backport found. |
| [deepmerge 4.3.1](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), Expo Config 55.0.21 | Build/configuration and plugin-property merging. No patched published version available. |

Stop for independent final review after this backend/integration delivery. No external deployment is authorized or performed.
