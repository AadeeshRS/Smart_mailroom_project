# Smart Mailroom v2: Implementation Plan

| | |
|---|---|
| Date | 2026-11-14 |
| Baseline | `main` @ `2e5b179`, plus the Expo SDK 58 upgrade on branch `expo-sdk-58` |
| Status | Plan approved for implementation. This file is the **source of truth** for the implementation session. |
| Supersedes | Phases B6, B7 and C of `docs/PRODUCTION_READINESS_PLAN.md`. Its other findings (logging, deployment, database roles, EAS builds, privacy) are folded into Phase 8 here. |

## 0. Rules for the implementation session

1. Do the phases in order. Each phase ends with every test suite green and the acceptance checks met. Commit at the end of each task, with small commits.
2. **Contract first.** Every API change starts in `contracts/openapi.yaml`, then `npm run generate && npm run validate && npm run check` in `contracts/`. Generated files are never edited by hand.
3. **Backend and frontend stay separate.** `api/` never imports from `mobile/`, and `mobile/` never imports from `api/`. The only shared code is the generated contract types in `contracts/generated/`.
4. Before adding a helper, check whether one already exists (section 3.3 lists what to reuse). Add no new dependency where a few lines will do. A shortcut with a known limit gets a `ponytail:` comment naming the limit and how to upgrade.
5. Every non-public operation declares an `x-permission` in the contract. The route × role matrix test (task 2.6) must fail if one doesn't.
6. Tests run only against a **local** `smart_mailroom_test` database. Never run tests against the shared online database.
7. Stop and ask the user if something in section 9 ("Needed from the user") is missing when a task needs it.
8. **Expo Go only, permanently.** The app is previewed only in Expo Go (SDK 58) and is never rebuilt during
   development. Every commit must open and run in Expo Go with no red screens and no warnings. Add native packages
   only with `npx expo install`, and only ones Expo Go includes. `mobile/tests/expo-go.test.ts` (run in CI) fails if
   a dependency is in neither `expo/bundledNativeModules.json` nor its short allowlist of JS-only packages. What
   Expo Go can't do (push on Android) is skipped there quietly and waits for the release builds in Phase 8.
9. **Before every push,** run `pwsh scripts/check.ps1` from the repo root. It runs every check in one chain and
   stops at the first failure: contracts, API typecheck, tests and format, mobile typecheck, lint, tests and
   format, then a web export and both browser suites. `-SkipBrowser` leaves the browser suites out, and is only
   for changes with no API or mobile behaviour. Never push with a failing check.

## 1. Decisions (locked with the user)

| # | Decision |
|---|---|
| L1 | **One shared online PostgreSQL database** that everyone uses. The user will provide the connection URL. |
| L2 | **Login is college email + password**, and the email address must be verified with a 6-digit code before login works. Password reset uses the same emailed code. Members self-register only with a college domain. Operator and admin accounts are created by an admin, and get an emailed code to set their password. |
| L3 | **Parcel details are typed in by the operator** from the label after the barcode scan: recipient name, phone, and optionally email, hostel and room. The **carrier is detected automatically** from the AWB format. No paid tracking API and no OCR in v1. |
| L4 | **Three roles: MEMBER** (student or college staff, with an enrollment or staff ID), **OPERATOR** (security and mailroom staff), and **ADMIN** (everything an operator can do, plus the dashboard and management). |
| L5 | **The API is hosted on Render or Railway** with HTTPS. Every phone and teammate uses the same API URL, and only the deployment runs migrations. |

Why L3: carrier tracking APIs return the status and location for an AWB, but never the recipient's name or phone. Labels sometimes mask phone numbers too. That makes **requests (W6) the reliable way to match a parcel**; matching on contact details (W4) is a convenience.

## 2. Target workflows

These IDs are referenced throughout the plan.

| ID | Workflow |
|---|---|
| W1 | **Shared database.** All clients go through one deployed API backed by one shared Postgres database. |
| W2 | **Operator intake.** Scan the barcode, which gives an AWB or an order ID (whichever is printed). A lookup then shows: the detected carrier, any member request for that AWB (**including the delivery OTP to read out to the delivery partner**), and a warning if the AWB was already logged. The operator enters the label's name, phone, email, hostel and room (prefilled from the requester's profile when there is a request; otherwise **Look up member** takes the label's email or phone, or the member's enrollment ID, and one match fills the blank fields from their profile; either way the operator checks them against the label), plus the shelf, then saves. The parcel is matched automatically and the member is notified. |
| W3 | **Member registration and profile.** College email (login, can't be changed), name (can't be changed), member type (student or staff), enrollment/staff ID, personal email, phone, alternate phone, hostel (picked from a list) and room (typed). Everything except college email and name can be edited later. |
| W4 | **Contact match.** If a member's phone, alternate phone, college email or personal email matches the contact on a logged parcel, the parcel appears on their home screen with a **Collect now** button. |
| W5 | **Collection.** Collect now creates one one-time code (OTP) covering **all of the member's parcels waiting in the mailroom and linked to them**. It's shown to the member as a QR and as digits, and the member **joins the list on the operator's Giveaway screen** (nothing pops up over what the operator is doing) with their parcels listed once. The operator **scans the member's QR**, which finds and verifies their code in one step, or opens the member from the list and types the OTP; then the operator ticks the parcels handed over. Those move to the member's **past parcels**; unticked ones stay in the mailroom. |
| W6 | **Requests.** A member enters an AWB, plus an order ID if they have one. When that parcel is scanned it's linked to them **without needing a contact match**, and they're notified. Creating a request for a parcel that's already in the mailroom links it straight away, which is how a member can check whether their parcel has arrived. |
| W7 | **Arrival notification.** A push notification (plus an in-app inbox entry) whenever a parcel is linked to a registered member. |
| W8 | **Delivery OTP.** A member adds the OTP the courier sent them to a request. When the operator scans that AWB, they see the OTP, give it to the delivery partner and log the parcel. The stored OTP is then cleared. |
| W9 | **Role-based access and admin.** An admin dashboard shows parcels received and collected today, how many are pending, which parcels have waited too long (with actions: send a reminder, mark returned), user management, and the hostel list. |

## 3. What exists today: keep, change, remove

The current repo implements a different workflow: merchant-order registration, an evidence-fingerprint matching engine, reconciliation checklists, holds and disputes, QR codes and response-loss recovery. **The new workflow is simpler, so v2 keeps the scaffolding and replaces the domain layer.** The codebase gets smaller overall.

### 3.1 Status against the target workflows

| Workflow | Status | Notes |
|---|---|---|
| W1 Shared DB | Missing | Local trust-auth cluster only |
| W2 Intake | Partial | A scan-to-intake screen exists (`mobile/src/screens/staff.tsx`, `mobile/src/Scanner.tsx`). No lookup, carrier detection or delivery OTP |
| W3 Registration/profile | Missing | Users come only from the seed script; there's no hostel, phone or ID data |
| W4 Contact match | Missing | Matching uses order identifiers plus label email or student number, not phones |
| W5 Collection | Partial | Hashed OTP, 10-minute expiry and a 5-attempt limit exist (`api/src/credentials.ts`). No operator queue or pop-up; uses two steps plus QR |
| W6 Requests | Partial | "Expected orders" exist, but require a platform and merchant order ID; the AWB is optional |
| W7 Notifications | Partial | In-app inbox and an outbox table exist; nothing is actually delivered |
| W8 Delivery OTP | Missing | |
| W9 Role-based access / admin | Partial | Two roles with hand-written checks; no admin, dashboard or user management |

### 3.2 Remove

Each item duplicates other code or belongs to the old workflow.

| Remove | Why |
|---|---|
| `mobile/src/api/mock.ts` (40 KB) plus `tests/mock.test.ts`, `tests/review.test.ts`, the `e2e/` mock journey, `playwright.config.ts` and `e2e/serve.cjs` | A second implementation of the whole backend inside the app. With a shared deployed API it's pure duplication |
| `mobile/src/api/writeRecovery.ts`, `src/confirmationRecovery.ts`, `src/screens/writeRecovery.tsx`, `src/screens/recovery.tsx`, `app/recover/` | Client-side durability machinery for the old idempotency model. v2 uses client-generated IDs instead (section 4.6) |
| `api/src/matching.ts` (fingerprints, evidence baselines, `recheck`), `api/src/identifiers.ts` (namespace catalogue), `api/src/guides.ts` | The old matching engine. Replaced by the targeted matching in section 4.7 |
| Reconciliation, holds, disputes, revisions, the QR credential, verification rows, snapshot pagination, the idempotency table | The old workflow's complexity; the new flow doesn't need it |
| Demo login, demo reset, `DEMO_ACCOUNTS`, `DemoBanner` | Replaced by real accounts. The seed script survives as a dev-only fixture loader |
| Old Prisma migrations | There's no production data, so v2 starts from **one new baseline migration**. The shared database is created fresh |

### 3.3 Reuse

Adapt these rather than rewriting them.

| Reuse | From | For |
|---|---|---|
| scrypt password hashing, token, SHA-256 digest, HMAC, OTP generator, constant-time compare | `api/src/security.ts` | Passwords, sessions, email codes, collection OTPs |
| Generating routes and validation from the contract, the error envelope | `api/src/app.ts`, `api/src/contract.ts`, `api/src/errors.ts` | The router, plus one central permission check from `x-permission` |
| Rate limiter in the database | `api/src/context.ts` (`rate`) | Login, register, code requests, OTP attempts |
| Hashed session tokens | `Session` model, `backend.ts` login | Sessions, with a 7-day sliding expiry |
| Append-only audit trigger | `migrations/202610280002_invariants` | `AuditEvent`, without the `mailroom.reset` bypass (finding F18 in the review) |
| Background worker loop | `api/src/server.ts` | Push and email sending, cleanup, reminders, expiring requests |
| Contract codegen tooling | `contracts/tooling/*` | Unchanged; the `x-roles` metadata becomes `x-permission` |
| Barcode scanner | `mobile/src/Scanner.tsx` | Intake scanning |
| UI components, `useResource` and `useAction` hooks | `mobile/src/ui.tsx`, `mobile/src/runtime.tsx` | All screens |
| Accessible motion: `MotionProvider` (follows the OS reduce-motion setting), `useEntrance`, `usePressScale` | `mobile/src/motion.tsx` | Screen entrances and button feedback; no animation library |
| `SuccessMark` (animated checkmark) | `mobile/src/ui.tsx` | Confirmations: intake saved, handover completed |
| HTTP client | `mobile/src/api/http.ts` | Kept, with the token persisted in SecureStore |
| PostgreSQL integration-test pattern, the HTTP browser-test supervisor | `api/tests/`, `mobile/e2e-http/` | v2 tests |
| Dev-renderer browser harness: `playwright.dev.config.ts`, `api/tests/dev-http.ts`, `e2e-dev/` (API on 3100, Metro on 8083) | `mobile/`, `api/tests/` | Catches React Native development-only warnings (empty text) that web exports strip |

**Rule for every screen:** conditional rendering uses `{!!x && …}`, never `{x && …}`. A falsy string or `0` rendered bare inside a `View` triggers React Native's empty-text error; the dev-renderer suite checks for it.

## 4. Architecture

### 4.1 Repository layout

```
contracts/            openapi.yaml (v1.0.0) + tooling + generated/   ← the only shared code
api/                  backend (Fastify + Prisma + PostgreSQL)
mobile/               frontend (Expo Router, SDK 58)
docs/                 plans, deployment, ADRs
```

### 4.2 Backend modules

```
api/src/
  server.ts              start the HTTP server and the worker
  app.ts                 Fastify setup; routes generated from the contract; central permission check; after each
                         successful write, replies first and then hands it to realtime.afterWrite
  realtime.ts            the live-update WebSocket at /v1/realtime: authentication, heartbeat, who hears about which
                         write (in memory; see 4.10)
  core/
    config.ts            environment parsing and production guards
    db.ts                Prisma client (no global lock, see 4.6)
    errors.ts            DomainError, fail()
    security.ts          crypto helpers (existing)
    rbac.ts              PERMISSIONS: role → permissions (the one place roles are defined)
    rate.ts              rate limiter (moved from context.ts)
    phone.ts             normalise to E.164 (+91…); one function, used everywhere
  modules/
    auth/       service.ts handlers.ts   register, verify email, login, logout, forgot/reset password
    users/      service.ts handlers.ts   /me profile (editable-field whitelist), devices; admin user management
    hostels/    handlers.ts              list (public), create/update (admin)
    parcels/    service.ts handlers.ts   lookup, intake, search, detail, manual assign
                carrier.ts               AWB → carrier (regex table, see 4.8)
                matching.ts              link(), findRecipient(), rematchFor(user | request)
    requests/   service.ts handlers.ts   member requests (AWB, order ID, delivery OTP)
    collection/ service.ts handlers.ts   collect now → OTP; operator queue; complete handover
    notifications/ service.ts handlers.ts in-app inbox; queue push/email; push + email senders
    admin/      handlers.ts              stats, aging list, remind, mark returned
  jobs/worker.ts         every 60 s: expire collections and requests, clean up sessions and rate rows, reminders,
                         retention, pushes; publishes a live update only to the members (and staff) a job affected
  scripts/create-admin.ts  production-safe first-admin bootstrap
```

Rules:
- `handlers.ts` maps `operationId` to a function `(input, ctx)`. It stays thin: unpack the input, call the service, shape the output.
- `service.ts` holds the business logic and talks to Prisma directly. **Don't add a repository layer**, because Prisma already is one.
- Modules call each other only through service functions. For example, `parcels.intake` calls `matching.link`, which calls `notifications.queue`.
- `app.ts` merges every module's handlers into one map. A startup check fails if any contract operation has no handler.

### 4.3 Role-based access control

- The contract declares one permission per operation: `x-permission: PUBLIC | AUTH | MEMBER | OPERATOR | ADMIN`.
- `core/rbac.ts` maps roles to permissions:
  - `MEMBER` → `AUTH`, `MEMBER`
  - `OPERATOR` → `AUTH`, `OPERATOR`
  - `ADMIN` → `AUTH`, `OPERATOR`, `ADMIN`
- One check in the router loads the session, rejects inactive users, and checks the permission. Handlers never check roles themselves.
- **Ownership checks stay in the services.** A member only ever sees their own parcels and requests; anything else returns 404.
- The matrix test walks every contract operation and every role, and asserts the expected 401/403/2xx.

### 4.4 Frontend modules

```
mobile/
  app/                         Expo Router: route groups = role sections
    _layout.tsx                SessionProvider; redirect by role
    (auth)/login.tsx register.tsx verify-email.tsx forgot-password.tsx
    (member)/_layout.tsx       tabs: Home · Requests · History · Profile
      index.tsx                ready to collect (Collect now) + matched requests
      requests.tsx             list, new request, edit delivery OTP, cancel
      history.tsx              past parcels
      profile.tsx              edit allowed fields, change password, logout
      parcel/[id].tsx          details + OTP sheet after Collect now
    (operator)/_layout.tsx     tabs: Scan · Giveaway · Parcels · Profile; the giveaway queue updates live; new codes join the list, nothing pops up
      scan.tsx                 scan → lookup panel (request, delivery OTP, duplicates) → intake form
      giveaway.tsx             pending collections; enter OTP → hand over
      parcels.tsx              search, unmatched filter, manual assign
    (admin)/_layout.tsx        tabs: Dashboard · Aging · Users · Hostels (+ operator tabs)
  src/
    api/        http.ts (existing) · routes.generated.ts
    session/    SessionProvider.tsx: SecureStore token, restore on launch, logout
    push/       register.ts: expo-notifications permission + token upload
    hooks/      useResource, useAction (moved from runtime.tsx)
    ui/         components (existing ui.tsx, split only if it grows past one file)
    Scanner.tsx (existing)
```

The screens call `api.*` directly through `useResource` and `useAction`. **No state-management library.** A screen that grows past about 150 lines gets broken into components in the same folder.

### 4.5 Data model (Prisma sketch)

```prisma
enum Role        { MEMBER OPERATOR ADMIN }
enum MemberType  { STUDENT STAFF }
enum ParcelStatus { IN_MAILROOM COLLECTED RETURNED }
enum MatchSource { REQUEST CONTACT MANUAL }
enum RequestStatus { OPEN MATCHED CANCELLED EXPIRED }
enum CollectionStatus { PENDING VERIFIED COMPLETED CANCELLED EXPIRED }

model User {
  id            String  @id
  role          Role    @default(MEMBER)
  email         String  @unique        // college email for members; any email for operators. Lowercase. Can't be changed.
  name          String                 // can't be changed by the member
  passwordHash  String?
  emailVerifiedAt DateTime?
  active        Boolean @default(true)
  memberType    MemberType?
  idNumber      String? @unique        // enrollment / staff ID
  personalEmail String?                // lowercase
  phone         String? @unique        // E.164; unique, so one person can't take over another's number
  altPhone      String?
  hostelId      String?
  roomNumber    String?
  createdAt     DateTime @default(now())
  @@index([altPhone]) @@index([personalEmail])
}
model Hostel     { id String @id; name String @unique; active Boolean @default(true) }
model EmailCode  { id String @id; userId String; purpose String /* VERIFY | RESET */; codeDigest String; attempts Int @default(0); expiresAt DateTime; consumedAt DateTime? }
model Session    { id String @id; tokenDigest String @unique; userId String; expiresAt DateTime; revokedAt DateTime?; @@index([userId]) @@index([expiresAt]) }
model Device     { token String @id; userId String; platform String; createdAt DateTime @default(now()); @@index([userId]) }

model Parcel {
  id             String @id              // client-generated UUID → retrying intake can't create a duplicate
  awb            String?                 // normalised: trimmed, uppercase, spaces removed
  orderId        String?
  carrier        String?                 // from carrier.ts, or chosen by the operator
  labelName      String?
  labelPhone     String?                 // E.164 if parseable, otherwise null (masked numbers)
  labelEmail     String?
  labelHostel    String?
  labelRoom      String?
  shelf          String
  note           String?
  status         ParcelStatus @default(IN_MAILROOM)
  recipientId    String?
  matchSource    MatchSource?
  matchFlag      String?                 // AMBIGUOUS | CONFLICT → operator review
  receivedAt     DateTime @default(now())
  receivedById   String
  collectedAt    DateTime?
  collectedById  String?
  lastRemindedAt DateTime?
  @@index([awb]) @@index([orderId]) @@index([labelPhone]) @@index([labelEmail])
  @@index([recipientId, status]) @@index([status, receivedAt])
  // CHECK: awb IS NOT NULL OR orderId IS NOT NULL
}
model ParcelRequest {
  id String @id; userId String; awb String; orderId String?; carrier String?
  deliveryOtp String?                    // plain text (the operator must read it out); cleared on match or expiry
  note String?; status RequestStatus @default(OPEN); parcelId String?
  createdAt DateTime @default(now()); expiresAt DateTime
  @@index([userId, status]) @@index([orderId])
  // partial unique: one OPEN request per awb
}
model Collection {                       // one per Collect now tap; covers all the member's waiting parcels
  id String @id; userId String
  otpDigest String; attempts Int @default(0); status CollectionStatus @default(PENDING)  // PENDING → VERIFIED → COMPLETED
  requestedAt DateTime @default(now()); expiresAt DateTime
  completedAt DateTime?; operatorId String?
  @@index([status, requestedAt])
  // partial unique: one PENDING or VERIFIED per member
}
model Notification { id String @id; userId String; parcelId String?; type String; title String; body String; createdAt DateTime @default(now()); readAt DateTime?; pushState String @default("PENDING"); pushAttempts Int @default(0); @@index([userId, createdAt]) @@index([pushState]) }
model AuditEvent  { id String @id; actorId String; parcelId String?; action String; detail String; at DateTime @default(now()); @@index([parcelId, at]) }   // append-only trigger
model RateWindow  { key String @id; count Int; expiresAt DateTime; @@index([expiresAt]) }
```

### 4.6 Concurrency and safe retries

There is **no global advisory lock**; this fixes F7 and F8 in the review. The cases that need care are handled like this:

- **Intake retry:** the parcel `id` is a UUID generated on the phone (`expo-crypto` `randomUUID()`). A retry inserts the same ID, the unique key violation is caught, and the existing parcel is returned.
- **Completing a handover:** verifying the OTP moves the collection `PENDING → VERIFIED` with a conditional update. Completing runs, in one transaction, `UPDATE "Collection" SET status='COMPLETED' … WHERE id=$1 AND status='VERIFIED' AND "expiresAt" > now()` and `UPDATE "Parcel" SET status='COLLECTED' … WHERE id IN (ticked) AND "recipientId"=member AND status='IN_MAILROOM'`. If the collection isn't updated, or fewer parcels are updated than were ticked, the whole transaction rolls back. A double tap can't hand a parcel over twice.
- **Linking a parcel:** `UPDATE "Parcel" SET "recipientId"=… WHERE id=… AND "recipientId" IS NULL`. Two links racing can't both win.
- **One open request per AWB, one open collection per member:** enforced by partial unique indexes in the database.

### 4.7 Matching (targeted, using indexes, no table scans)

```
findRecipient(parcel):
  1. request = OPEN ParcelRequest where awb = parcel.awb (or orderId = parcel.orderId when there's no AWB)
     if request:
        request → MATCHED, deliveryOtp cleared
        if the label's contact belongs to nobody, or request.user is one of its owners → link(parcel, request.user, REQUEST)
        else (it belongs only to other members) → flag CONFLICT (operator decides)
  2. else candidates = active MEMBERs where phone = labelPhone OR altPhone = labelPhone
                                    OR email = labelEmail OR personalEmail = labelEmail
     1 candidate → link(CONTACT); >1 → flag AMBIGUOUS; 0 → stays unlinked

Reverse triggers (each only queries the rows involved):
  - request created  → look for an unlinked IN_MAILROOM parcel with that awb/orderId → link at once ("it's already here")
  - email verified or phone/email edited → look for unlinked parcels with those contacts → link if unambiguous
  - operator "assign" → link(MANUAL)

link(): conditional update → audit event → notifications.queue(ARRIVAL)
```

Only members with a **verified** email are matched. Unverified accounts can't receive parcels.

### 4.8 Carrier detection

`parcels/carrier.ts` holds a table of `{ carrier, pattern }` covering Delhivery, Blue Dart, Ekart, Amazon (TBA…), DTDC, Xpressbees, Shadowfax and India Post. It returns the first match, or `UNKNOWN`, and the operator can override it. The lookup also tells an AWB apart from an order ID by pattern. Amazon order IDs look like `\d{3}-\d{7}-\d{7}` and Flipkart's like `OD\d+`; the operator can switch the kind manually.

### 4.9 API surface (contract v1.0.0)

| Method and path | Permission | Purpose |
|---|---|---|
| `POST /auth/register` | PUBLIC | Create a member (college domain only); emails a verification code |
| `POST /auth/verify-email` · `POST /auth/resend-code` | PUBLIC | Verify with the code and start a session · send the code again (rate-limited) |
| `POST /auth/login` | PUBLIC | Email + password → session (`EMAIL_NOT_VERIFIED` if not verified yet) |
| `POST /auth/forgot-password` · `POST /auth/reset-password` | PUBLIC | Request a reset code (always 202) · set a new password with the code (also how invited operators set theirs) |
| `DELETE /auth/session` | AUTH | Log out |
| `GET /hostels` | PUBLIC | Hostel list for the registration dropdown |
| `GET /me` · `PATCH /me` · `POST /me/password` | AUTH | Profile · edit allowed fields (`PATCH` rejects `email` and `name`) · change password |
| `PUT /me/devices` | MEMBER | Register this phone's push token for the current session (ends with the session) |
| `GET /me/notifications` · `POST /me/notifications/read` | MEMBER | The latest 30 notifications · mark them all read |
| `GET /me/parcels?view=ready\|history` | MEMBER | Home (ready to collect) and past parcels |
| `GET /me/requests` · `POST /me/requests` · `PATCH /me/requests/{id}` · `DELETE /me/requests/{id}` | MEMBER | Requests. `POST` returns the matched parcel if it's already in the mailroom |
| `POST /me/collection` · `DELETE /me/collection` · `GET /me/collection` | MEMBER | Collect now → `{ id, otp, expiresAt, parcels }` for all the member's waiting parcels (replaces any open code) · cancel · the open code's id, state and expiry, never the OTP (the code sheet uses it to close when the code is replaced or used) |
| `GET /parcels/lookup?code=` | OPERATOR | Detected carrier and kind, the matching OPEN request (member name, room, **delivery OTP**), existing parcels with this code |
| `POST /parcels` | OPERATOR | Intake (UUID `id`), runs matching, returns the parcel and the match result |
| `GET /parcels?q=&status=&unmatched=&cursor=` · `GET /parcels/{id}` | OPERATOR | Search (keyset pagination) · detail with audit history |
| `POST /parcels/{id}/assign` · `GET /members?q=` | OPERATOR | Manually link a parcel · search members by name, ID, phone or room |
| `GET /collections` | OPERATOR | Giveaway queue: each open code once, with the member (name, ID, hostel/room) and their waiting parcels (label name, whether it matches, shelf) |
| `POST /collections/{id}/verify` · `POST /collections/{id}/complete` | OPERATOR | `{ otp }` → verify (5 wrong attempts cancel the code) · `{ parcelIds, idChecked }` → hand over the ticked parcels |
| `GET /admin/stats?dayStart=` | ADMIN | Received and collected that day (`dayStart` is local midnight on the phone, so no server time zone), waiting total, waiting by age (under 3 days, 3 to `WAITING_TOO_LONG_DAYS`, longer), unmatched, open requests |
| `GET /admin/parcels/aging?olderThanDays=` | ADMIN | Parcels waiting too long, with recipient contact details |
| `POST /admin/parcels/{id}/remind` · `POST /admin/parcels/{id}/return` | ADMIN | Send a reminder push · mark returned to sender |
| `GET /admin/users` · `POST /admin/users` · `PATCH /admin/users/{id}` | ADMIN | List and search · create an operator or admin (invite code emailed) · change role or deactivate (deactivating revokes their sessions) |
| `POST /admin/hostels` · `PATCH /admin/hostels/{id}` | ADMIN | Manage the hostel list |
| `GET /realtime` (WebSocket upgrade, `x-realtime` in the contract) | AUTH, by a token in the first frame | Live updates: frames are only `{ type }` (`ready`, `changed`, `ping`); see 4.10 |
| `GET /healthz` · `GET /readyz` | outside the contract | Is the process alive · can it reach the database |

### 4.10 Notifications

- `notifications.queue(userId, type, title, body, parcelId)` inserts a `Notification` row in the **same transaction** as the change that caused it.
- `jobs/worker.ts` sends pending pushes through the Expo push API with plain `fetch`, no SDK needed. It retries with backoff up to 5 times, and deletes devices the push service reports as invalid.
- **Emails** (verification and reset codes, operator invites) are sent synchronously through Resend's HTTP API with `fetch`. In development and test a console provider is used, and in production a missing API key stops the server from starting.
- **Live updates** (`api/src/realtime.ts`, `mobile/src/realtime.ts`; details in `docs/REALTIME.md`): one WebSocket per signed-in app in the foreground. The first frame carries the session token; frames from the server are only `{ type }`, and a `changed` frame makes the app re-read its open screens over HTTP. Who hears what:
  - changes to parcels, requests, collections, users and hostels: the affected members and every staff app;
  - personal writes (logout, profile, password, notifications, devices): only the writer's other sessions;
  - public writes (sign-up, codes, login, password reset): nobody;
  - never the session that made the write, which refreshes itself; the worker only tells the members (and staff) its jobs affected.
- **Cost of an idle app:** none on the database. Publishing and the 20-second ping work from memory; a session is re-read only when its expiry passes or a write can have ended it (logout, password change or reset, deactivation, role change), and ended sessions close with 4001. The HTTP reply is sent before the fan-out.
- **Giveaway list:** the giveaway queue is a live resource on the Giveaway screen; a new code joins the list and never opens a sheet by itself, so it can't cover a handover or intake in progress. The member's QR carries the code's id and digits (`mailroom-collect:<id>:<otp>`); scanning it calls verify directly. Without a socket, open screens re-read every 15 s.

### 4.11 Shared database and hosting

- **Database:** Neon, Postgres 17, database `smart_mailroom_dev` (`docs/DEPLOYMENT.md` has the project details).
- **Connection string:** one **direct (non-pooled)** `DATABASE_URL` with `sslmode=require`, used by both the running API and its migrations; one API instance with a 12-connection pool doesn't need Neon's pooler. It lives only in Render's environment and in the git-ignored `api/.env.neon` on the laptop that set the database up.
- **API:** a Render web service on the Free plan, built from `api/`. Build: `npm ci --include=dev && npm run generate && npm run build`. Start: `npm run migrate && npm start` (the Free plan has no pre-deploy step; `migrate deploy` does nothing when the schema is current). Health check: `/readyz`. The environment variables are listed in `docs/DEPLOYMENT.md`.
- **Mobile:** `EXPO_PUBLIC_API_BASE_URL=https://<service>/v1`. That works on any network with no LAN setup.
- **Migrations run from the deployment:** Render's start command applies them. The only steps a laptop runs against Neon are `prisma migrate status` / `migrate deploy` the guarded way in `docs/DEPLOYMENT.md` (the URL from `api/.env.neon` only, never `api/.env`), and `npm run create-admin:neon`, which refuses any host not ending in `neon.tech`. Never `migrate reset`, `db push`, the seed, the API tests or the browser suites. Developers use a local database for development and always for tests.
- Render's Free plan sleeps after 15 minutes idle (the first request then takes about a minute), and the background worker runs only while it's awake. It has no Shell, so the first admin is created from a laptop with `npm run create-admin:neon` (`docs/DEPLOYMENT.md`).
- **WebSockets on Render Free** work; Render counts WebSocket messages as traffic, so an app left open in the foreground (it answers a ping every 20 s) keeps the service awake, and the worker's minute runs keep Neon's compute awake too. The live-update hub is in memory: it's correct for this one instance, and needs shared pub/sub before running two.

## 5. Security controls specific to this workflow

| Risk | Control |
|---|---|
| Someone creates a request with another person's AWB to take their parcel | One open request per AWB. A CONFLICT flag if the label contact matches a different member. **At handover the operator sees the label name next to the member's name and ID** and checks their ID card. Every link is audited with its source |
| A member enters someone else's phone number | The primary phone is unique across users. Contact matches need a verified email. The same name check at handover applies. Contact matching is treated as convenience, not proof |
| Collection OTP guessing | Stored as HMAC with the pepper, 15-minute expiry (`COLLECTION_CODE_MINUTES`), 5 attempts, then the code is cancelled. Collect now is limited to 6 per minute per member. A new code replaces the open one |
| Delivery OTP exposure | Returned only by `GET /parcels/lookup` to operators. Never shown in lists or logged. Cleared on match, cancellation or expiry (requests expire after 30 days) |
| Account takeover | scrypt passwords (minimum 8 characters). Login limited to 10 per 15 minutes per email and per IP. Code verification capped at 5 attempts. Reset revokes all sessions. Same response whether or not an email is registered |
| Privilege escalation | Roles change only through `PATCH /admin/users` (ADMIN). An admin can't demote themselves or deactivate the last admin. One permission check, plus the matrix test |
| Personal data | Members see only their own data. Operators see contact details only for parcel work. No phone numbers, OTPs, passwords or tokens in logs (log redaction in Phase 8) |
| The live-update socket leaks data or is abused | Frames carry only `{ type }`, never IDs, contacts or OTPs; screens re-read through the ordinary permission-checked HTTP API. The token goes in the first frame, never a URL (a query string gets 400), so there's no Origin check (no cookie to ride on). 5 seconds to send it, then the socket is terminated; 2 KiB per frame; 5 sockets per user; 10 unauthenticated sockets per IP; 500 in all. Members hear only about their own changes |

## 6. Implementation phases

Sizes: **S** < 1 day · **M** 1-3 days · **L** 3+ days.

### Phase 0: Clean slate (S)

| Task | Acceptance |
|---|---|
| 0.1 Commit and merge the SDK 58 upgrade (branch `expo-sdk-58`), and update the README's version numbers | Mobile typecheck, lint and tests green |
| 0.2 Add Prettier (`printWidth: 120`) to `api/` and `mobile/`, and format everything in one formatting-only commit | Diff is whitespace only |
| 0.3 GitHub Actions CI: contracts (generate, validate, check); api (Postgres 17 service, migrate, build, test); mobile (typecheck, lint, test, format check) | CI green on a PR |

### Phase 1: Shared database and hosted API (S)

**This is the user's first priority.** It needs the database URL and a Render or Railway account (section 9).

| Task | Acceptance |
|---|---|
| 1.1 Confirm SSL connections work (`sslmode=require` is passed through to `pg`). No `DIRECT_DATABASE_URL`: one direct `DATABASE_URL` serves the API and migrations (§4.11) | `npm run migrate` succeeds against the online database |
| 1.2 Add `GET /healthz` and `/readyz`; add `TRUST_PROXY`; turn on the Fastify logger with redaction of the authorization header and secret fields; log unexpected errors with their requestId | `/readyz` is 200, or 503 with the database down; one log line per error |
| 1.3 Set the contract path explicitly (`CONTRACT_PATH`, or copy `contracts/openapi.yaml` into the build) so the API doesn't depend on its working directory | The API starts from any directory |
| 1.4 Deploy to Render or Railway as described in 4.11. For **this phase only**, the staging service runs `NODE_ENV=development` and `DEMO_ENABLED=true`, and is seeded once with `npm run seed` | Teammates' phones log in through `https://…/v1` and see the same data |
| 1.5 Put the shared API URL in `mobile/.env.example` and write `docs/DEPLOYMENT.md` (environment variables, deploy, migrations, rollback) | A new teammate connects using only the docs |

### Phase 2: Identity, profiles and role-based access (L)

| Task | Acceptance |
|---|---|
| 2.1 Contract v1.0.0 skeleton: auth, `/me`, hostels, and admin user and hostel operations, with `x-permission` on every operation. Remove the old operations as their modules are deleted | Contract validate and check pass |
| 2.2 Remove the items in section 3.2 (mock adapter, recovery code, old domain modules, demo login). Create the v2 baseline migration (section 4.5), including the append-only audit trigger **without** a reset bypass. Reset the shared database (it holds only synthetic data) | Builds green; the shared database is on the v2 schema |
| 2.3 Create the `core/` and `modules/` structure (4.2), the central permission check (4.3), and the startup check that every operation has a handler | Startup fails if a handler is missing |
| 2.4 `auth` module: register (college domain from `ALLOWED_EMAIL_DOMAINS`), email codes (6 digits, HMAC, 10-minute expiry, 5 attempts, latest only), login, logout, forgot and reset password, 7-day sliding sessions, rate limits, Resend and console email providers | Tests: register → verify → login; wrong code ×5 locks; unverified login refused; reset revokes sessions; no account enumeration |
| 2.5 `users` module: `/me` GET and PATCH. The PATCH whitelist is personal email, phone, alt phone, hostel, room and ID; email and name are rejected. Phones normalised by `core/phone.ts`; unique phone and ID give a clear error. Admin user list, create (with invite code) and update; the last-admin guard. `hostels` module. `scripts/create-admin.ts` | Tests for each rule; `create-admin` works with `NODE_ENV=production` |
| 2.6 **Route × role matrix test** covering every operation × {anonymous, MEMBER, OPERATOR, ADMIN} | Fails when an operation is missing from the expected table |
| 2.7 Mobile: the `(auth)` screens (registration form with every W3 field and the hostel dropdown), `SessionProvider` with `expo-secure-store` (restore on launch), redirect by role to the `(member)`, `(operator)` and `(admin)` groups, and the profile screen | The app survives a restart while signed in; each role lands in its own section |

### Phase 3: Parcel intake and matching (M) for W2 and W4

| Task | Acceptance |
|---|---|
| 3.1 `parcels/carrier.ts` with a test table of real AWB and order-ID formats | Unit tests pass |
| 3.2 `GET /parcels/lookup` and `POST /parcels` (UUID id; normalise the AWB, order ID and phone; require at least one of AWB or order ID) | A retried intake returns the same parcel; a duplicate AWB shows a warning in lookup |
| 3.3 `parcels/matching.ts` as in 4.7, including the reverse trigger on profile changes and email verification | Tests: contact match, ambiguous, no match, verified-only, a profile edit links an existing parcel |
| 3.4 Operator search with keyset pagination, an unmatched filter, `GET /members?q=` and manual assign | Tests |
| 3.5 Mobile `(operator)/scan.tsx`: Scanner, then the lookup panel, then the intake form (label fields, shelf), then a result card showing who it matched. `parcels.tsx` with search and assign | Manual run: scan a test barcode, and a registered member sees the parcel on their home screen |
| 3.6 Mobile `(member)/index.tsx`: the ready-to-collect list | |

### Phase 4: Requests and delivery OTP (M) for W6 and W8

| Task | Acceptance |
|---|---|
| 4.1 `requests` module: create (one open request per AWB; links at once if the parcel is already in), list, edit the delivery OTP, cancel; requests expire after 30 days in the worker | Tests: an existing parcel links at once; a duplicate open AWB is refused; expiry clears the OTP |
| 4.2 Hook requests into `findRecipient` (step 1) and the lookup response (the delivery OTP is shown only there), and add the CONFLICT flag | Tests: a request beats a contact match; a contact owner who differs from the requester sets CONFLICT; the OTP is cleared after intake |
| 4.3 Mobile `(member)/requests.tsx` (form: AWB required, order ID and delivery OTP optional) and the delivery-OTP banner in the operator lookup panel | Manual: the member adds an OTP and the operator sees it when scanning |

### Phase 5: Collection (M) for W5

| Task | Acceptance |
|---|---|
| 5.1 `collection` module: Collect now (one code for all the member's waiting parcels; create or replace the open code, return the OTP), cancel, the operator queue (each member once, with their parcels), verify (5 attempts, then cancelled) and complete (the ticked parcels; atomic conditional updates as in 4.6; audit). Unticked parcels stay `IN_MAILROOM` | Tests: happy path with one of two parcels ticked; wrong OTP ×5 cancels the code; an expired code fails; a double complete gives `ALREADY_COLLECTED`; replacing a code invalidates the old one; a parcel that isn't the member's rolls the handover back |
| 5.2 Notifications for collection-requested (to operators: optional push) and collected (to the member) | |
| 5.3 Mobile member Collect now sheet (large OTP, countdown, regenerate) and `history.tsx` | |
| 5.4 Mobile `(operator)/giveaway.tsx`: a live list (it polled every 5 s before the WebSocket channel; the pop-up it once had was removed because a new code covered the operator's current task), and a Scan member's QR button that verifies the code without typing. The panel shows the member's name, ID, hostel and room once, with each parcel's **label name** and shelf; after the OTP is verified the operator ticks the parcels handed over | End-to-end browser test: intake → Collect now → operator verifies and completes → the parcel shows in history |
| 5.5 **Name check (user rule).** Phone and personal email aren't verified but drive auto-linking, so the giveaway check is the real safeguard. If the label name is empty or shares no word with the member's name (case-insensitive), the panel shows a warning and the operator must tap **Checked ID card** before completing. The API enforces it: `complete` takes `idChecked`, refuses a mismatch without it, and records it in the audit entry | Test: a mismatch without `idChecked` is refused; with it, the handover completes and the audit entry says the ID card was checked |

### Phase 6: Push notifications (M) for W7

| Task | Acceptance |
|---|---|
| 6.1 `notifications` module: queue, inbox, mark read; device registration | Tests |
| 6.2 Worker push sender (Expo push API through `fetch`, retries, removal of invalid tokens) | Test with a mocked `fetch` |
| 6.3 Mobile push under rule 8: after login, ask for permission and upload the Expo push token; tapping a notification opens Home. Skipped in Expo Go on Android (`isRunningInExpoGo()` and `Platform.OS`), with `expo-notifications` loaded lazily so nothing errors or warns there. iOS in Expo Go registers with the EAS project ID from `eas init`. No Firebase and no builds until Phase 8 | An iPhone in Expo Go gets an arrival push. Android members in Expo Go see the parcel on Home with no push, as expected |
| 6.4 Reminder job: parcels in the mailroom longer than `REMINDER_AFTER_DAYS` (default 3) get one reminder each N days, tracked with `lastRemindedAt` | Test with an injected clock |

### Phase 7: Admin dashboard (M) for W9

| Task | Acceptance |
|---|---|
| 7.1 `GET /admin/stats` using database aggregates (counts with indexes on `receivedAt`, `collectedAt` and `status`); `GET /admin/parcels/aging`; remind; mark returned | Tests with seeded data on several dates |
| 7.2 Mobile `(admin)` screens: dashboard tiles (received today, collected today, pending, older than 7 days, unmatched), the aging list with actions, users (search, create an operator, change role, deactivate) and hostels | Manual run as admin |

### Phase 8: Hardening and release (M)

Pulls in the remaining items from `docs/PRODUCTION_READINESS_PLAN.md`.

| Task | Source |
|---|---|
| 8.1 Database roles: the app connects as a non-owner `mailroom_app`; migrations use the owner | F19 |
| 8.2 Backups (daily snapshots on the database provider, or `pg_dump`), plus one restore drill | F14 |
| 8.3 EAS build profiles, app name, icon, splash, iOS bundle ID and Android package name; Firebase/FCM credentials so Android gets pushes; an installable Android APK (internal distribution) | F23 |
| 8.4 Friendly error messages per error code (with the requestId in a details line); an accessibility pass; a physical-device test (label scan, collection) | F26, F27, F30 |
| 8.5 Privacy notice at registration; a retention job that pseudonymises old collected parcels | F36 |
| 8.6 Rewrite the README as developer documentation; a decision record reconciling the Phase 0 design (FastAPI / Next.js) with this stack | F33 |

## 7. Testing strategy

- **API:** `node:test` integration tests per module against the local `smart_mailroom_test` database, following the existing pattern in `api/tests/postgres.test.ts`. One file per module (`auth.test.ts`, `parcels.test.ts`, …) plus `rbac.test.ts` (the matrix test).
- **Mobile:** unit tests only for pure logic (carrier display, phone formatting, error-message mapping). Screens are covered by one end-to-end browser test of the full workflow (W2 → W5 → W6 → W8), using the existing `e2e-http` supervisor.
- **CI** runs all of it on every PR. The end-to-end test can run nightly if it's slow.

## 8. Effort and order

| Phase | Size | Can start after |
|---|---|---|
| 0 Clean slate | S | now |
| 1 Shared DB + hosted API | S | 0, plus the DB URL and hosting account |
| 2 Identity + RBAC | L | 1 |
| 3 Intake + matching | M | 2 |
| 4 Requests + delivery OTP | M | 3 |
| 5 Collection | M | 3 (can run alongside 4) |
| 6 Push | M | 2 (can run alongside 3-5 once the notification table exists) |
| 7 Admin | M | 5 |
| 8 Hardening | M | 7 |

## 9. Needed from the user

| Item | Needed by |
|---|---|
| An online Postgres database named `smart_mailroom_dev`, and its direct connection URL (done: Neon, `api/.env.neon`) | Phase 1 |
| A Render or Railway account connected to the GitHub repo | Phase 1 |
| College email domain(s) for `ALLOWED_EMAIL_DOMAINS` (done: `bmu.edu.in`; the tests keep the reserved `college.example`) | Phase 2 |
| A Resend account and API key, plus a sender address (a verified domain, or Resend's test sender for development) | Phase 2 |
| The hostel list | Phase 2 (or added later in the admin screen) |
| The first admin's email | Phase 2 (`create-admin`) |
| An Expo account, for the EAS project ID (`eas init`) that iOS push in Expo Go needs | Phase 6 |
| A Firebase project and FCM credentials for Android push, and the Android package name | Phase 8 (release builds) |
| Thresholds: **decided**, the defaults as environment variables: `REQUEST_EXPIRY_DAYS` 30, `COLLECTION_CODE_MINUTES` 15, `REMINDER_AFTER_DAYS` 3, `WAITING_TOO_LONG_DAYS` 7. The mailroom's return policy is still to be confirmed | Phase 4-7 |
| Retention: `RETENTION_DAYS` defaults to 90 (label details erased that long after a parcel leaves). **To be confirmed** with the college, along with what happens to a closed account's details | Phase 8 (8.5) |
| App name, icon and bundle ID | Phase 8 |
