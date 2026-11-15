# Smart Mailroom

A parcel app for a college mailroom. Operators scan a parcel's AWB and type the label's name and phone; the parcel
is matched to a member (a student or staff member) by an open request or by their contact details, and the member
is notified. To collect, the member taps **Collect now**, shows the code at the counter, and the operator checks
their college ID before handing over. Admins see a dashboard of what's waiting and manage users and hostels.

- **`contracts/`**: the OpenAPI contract (`openapi.yaml`), the single source of truth for the API. Generated types
  go to `contracts/generated/` and `mobile/src/api/routes.generated.ts`.
- **`api/`**: Node 24, Fastify 5, Prisma 7, PostgreSQL 17. One process serves the API and runs a background worker
  (pushes, reminders, expiries, retention).
- **`mobile/`**: Expo SDK 58 (React Native, Expo Router). Developed and previewed **only in Expo Go**; the browser
  tests use its web build.
- **`docs/`**: the [implementation plan](docs/IMPLEMENTATION_PLAN.md) (source of truth, with the rules for changes),
  [deployment](docs/DEPLOYMENT.md), [accessibility](docs/ACCESSIBILITY.md), the
  [stack decision record](docs/adr/0001-stack.md) and the [v1 history](docs/HISTORY.md).
- **`scripts/check.ps1`**: every check, in the order CI and a pre-push run need them.

## Quick start

You need Node 24 with npm 11, PostgreSQL 17 on your machine, and the Expo Go app (SDK 58) on a phone.

### 1. Two local databases

Development uses `smart_mailroom_dev` and the tests use `smart_mailroom_test`; the seed and the test reset refuse
any other name. On Windows, an isolated cluster that doesn't touch an existing PostgreSQL service:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$data = Join-Path $env:TEMP 'smart-mailroom-pg17'
& "$pgBin\initdb.exe" -D $data -U mailroom_admin -A trust --encoding=UTF8 --locale=C   # once
& "$pgBin\pg_ctl.exe" -D $data -l "$env:TEMP\smart-mailroom-pg17.log" -o '-p 55432 -h 127.0.0.1' -w start
& "$pgBin\createdb.exe" -h 127.0.0.1 -p 55432 -U mailroom_admin smart_mailroom_dev
& "$pgBin\createdb.exe" -h 127.0.0.1 -p 55432 -U mailroom_admin smart_mailroom_test
```

`trust` is only acceptable because the cluster listens on 127.0.0.1.

### 2. Contract

```powershell
cd contracts
npm ci
npm run generate
```

### 3. API

```powershell
cd api
npm ci
Copy-Item .env.example .env        # then edit it, see below
Copy-Item .env.example .env.test   # the same, for the tests
npm run generate
npm run migrate
npm run seed
npm run dev
```

In `.env`, set `DATABASE_URL` to the dev database (with the cluster above:
`postgresql://mailroom_admin@127.0.0.1:55432/smart_mailroom_dev`), a `CREDENTIAL_PEPPER` of at least 32 random
bytes (the command is in the file), and a `SEED_PASSWORD`. In `.env.test`, point `DATABASE_URL` at
`smart_mailroom_test` and set `NODE_ENV=test`. Every variable is described in
[DEPLOYMENT.md](docs/DEPLOYMENT.md#api-environment-variables-reference).

`npm run seed` creates three verified accounts with `SEED_PASSWORD`: `member@college.example`,
`operator@college.example` and `admin@college.example`. Without `RESEND_API_KEY`, emailed codes (registration,
password reset, invites) are printed in the API's console.

For a phone on your Wi-Fi, set `HOST=0.0.0.0` so the API listens on your LAN address.

### 4. App

```powershell
cd mobile
npm ci
Copy-Item .env.example .env   # EXPO_PUBLIC_API_BASE_URL=http://<your LAN IP>:3000/v1 for a phone
npx expo start
```

Scan the QR code with Expo Go. Native packages are added only with `npx expo install`, and only ones Expo Go
includes; `mobile/tests/expo-go.test.ts` fails otherwise. Push notifications work in Expo Go on iOS once
`app.json` has an EAS project ID; Android in Expo Go has no pushes, and members see their parcels and notices on
Home instead.

## Checks

### Automatic screen updates

Authenticated WebSockets notify focused screens when another client changes their data. Successful local
writes refresh immediately too. Reconnecting or returning to the app fetches current data, including changes
missed offline. Healthy connections do not poll every second; a 15-second fallback covers disconnected sockets
and failed reads. Requests are serialized and late responses from old screens/accounts are discarded. Unsaved
form fields survive refreshes. Collection removes handed-over parcels and closes the code sheet when none remain.
Replacing/cancelling a code on another device also clears the old presentation. Open staff handover sheets
follow verification and parcel changes, and stop accepting actions once the collection is inactive. Profile
updates from another device merge into untouched fields without erasing a local draft.
See [the protocol, deployment limits and device checks](docs/REALTIME.md). The hub supports one API process;
shared pub/sub is needed before scaling to multiple processes.

### Camera test labels

Open [the printable barcode labels](docs/test-labels/labels.html) on another screen, or print at 100% scale.
Each Code 128 barcode contains its displayed synthetic AWB. Add that AWB under the member's Requests, then use
**Scan barcode** as the operator on a physical phone. Confirm the decoded AWB, carrier and requested member,
enter a shelf, and save. Leave contact fields blank to test request matching alone. Existing AWBs may show a
duplicate warning; the labels do not create or reset any data.

Regenerate the labels with `node scripts/generate-test-labels.cjs` after installing `mobile/` dependencies.
The script uses Expo's installed barcode tooling and verifies every generated image decodes to its exact AWB.
That check does not replace a physical phone/camera test.

The [refinement summary and final phone checklist](docs/REFINEMENT_SUMMARY.md) records the tested edge cases,
current limitations and how to complete the final multi-phone check.

Before every push, from the repo root:

```powershell
pwsh scripts/check.ps1               # everything
pwsh scripts/check.ps1 -SkipBrowser  # only when no API or mobile behaviour changed
```

It stops at the first failure. The API tests and both browser suites run against the local `smart_mailroom_test`
database only.

| Where | Command | What |
|---|---|---|
| `contracts/` | `npm run generate` / `validate` / `check` | Generate types and routes; validate the contract and its examples; confirm the generated files are committed |
| `api/` | `npm test` | `node:test` integration tests per module, including the route × role matrix |
| `api/` | `npm run dev` / `build` / `start` | Run from source; compile; run the build |
| `api/` | `npm run migrate` / `seed` | Apply migrations; create the dev accounts |
| `api/` | `npm run create-admin -- <email> "<name>"` | First admin on the database in `.env`; `create-admin:neon` does it on the shared database (see DEPLOYMENT.md) |
| `mobile/` | `npm run typecheck` / `lint` / `test` | TypeScript, ESLint (no warnings allowed), Vitest unit tests |
| `mobile/` | `npx playwright test -c playwright.http.config.ts` | The full workflow in a browser, against a real API (needs a web export first; `check.ps1` does both) |
| `mobile/` | `npx playwright test -c playwright.dev.config.ts` | The development renderer, which catches React Native warnings a web export hides |
| both | `npm run format` / `format:check` | Prettier |

## How it fits together

- **Contract first.** Every API change starts in `contracts/openapi.yaml`. Each operation declares an
  `x-permission` (PUBLIC, AUTH, MEMBER, OPERATOR or ADMIN); the API checks it before anything else, and
  `api/tests/rbac.test.ts` fails if an operation is missing from its matrix.
- **API modules** (`api/src/modules/`): `auth` (register, email codes, sessions), `users`, `hostels`, `parcels`
  (intake, carrier detection, matching), `requests`, `collection` (Collect now codes and handover), `admin`
  (dashboard, reminders, returns) and `notifications` (inbox, push devices, the Expo push sender). `api/src/jobs/`
  holds the worker.
- **No global locks.** Races are settled by conditional updates and unique indexes; the audit log is append-only,
  enforced by a database trigger.
- **The app** (`mobile/app/` routes, `mobile/src/screens/` per role) talks to the API only through the generated
  client in `mobile/src/api/`. `api/` and `mobile/` never import each other.

## Deployment

The API runs on Render's Free plan against a shared Neon database; the app points at it with
`EXPO_PUBLIC_API_BASE_URL`. [DEPLOYMENT.md](docs/DEPLOYMENT.md) has the click-by-click setup, the environment
variables and how to create the first admin.
