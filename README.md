# Smart Mailroom

Expo / React Native frontend prototype for a college parcel mailroom. **Demo mode only.** Fixed fictitious accounts, local synthetic data, deterministic mock service. There is no backend, college SSO, external notification provider, shopping or courier integration.

`mobile/` contains Expo Router screens, reusable UI, a typed service boundary, local mock adapter and tests. `contracts/openapi.yaml` is the canonical **DRAFT — FRONTEND PROTOTYPE** contract. `contracts/generated/api.d.ts` is generated; do not edit it manually. Separate manifests and lockfiles keep app and contract tooling independent. Supplied diagrams remain local and are excluded from Git.

Use Node **24 LTS** (tested with 24.22.1) and npm 11 (tested with 11.6.2). Expo SDK 55 uses React 19.2.0 and React Native 0.83.10, selected from Expo's SDK compatibility metadata. See [Expo SDK 55](https://docs.expo.dev/versions/v55.0.0/) and [Router installation](https://docs.expo.dev/router/installation/).

From the repository root, in PowerShell:

```powershell
cd contracts
npm.cmd ci --cache "$env:TEMP\smart-mailroom-npm-cache"
npm.cmd run validate
npm.cmd run check
cd ..\mobile
npm.cmd ci --cache "$env:TEMP\smart-mailroom-npm-cache"
npm.cmd start
```

Press `w` for web, or scan Expo's development QR using a compatible Expo Go on a physical device. For a device without a compatible Expo Go, create an Expo development build using SDK 55. Camera scanning requires hardware, permissions, and on web a secure context such as localhost/HTTPS. `npm.cmd run web` opens web directly. The placeholder in `mobile/.env.example` is reserved for a future HTTP adapter; copying it does not connect a server.

Demo accounts (public passcode for all: `mailroom-demo`):

| Account | Provisioned identity | Role |
| --- | --- | --- |
| Asha Rao | `asha@students.example.invalid` / `DEMO1001` | Student |
| Neel Shah | `neel@students.example.invalid` / `DEMO1002` | Student |
| Mira Sen | `mira@staff.example.invalid` | Mailroom staff |

Choose an account on the clearly labelled demo login. Roles come from provisioned accounts in the service, not a role selector. Sessions last 30 minutes and are not restored after restart. Logout is in Account. Staff Account has an explicit confirmed data reset; it erases this device's synthetic history and revokes sessions. The connection simulation in Account exercises error/retry states without a real network request.

Try the complete journey on the same app instance:

1. As Asha, register Amazon merchant order `AMZ-DEMO-1001`. Open order-ID help. Tracking is optional and can be added from order details later.
2. Log out and sign in as Mira. Receive a parcel. Select `ORDER_ID`, namespace `AMAZON`, value `AMZ-DEMO-1001`; enter label email `asha@students.example.invalid` or student number `DEMO1001`. Add a description, storage location and a unique physical reference such as `BOX-001`.
3. Review the physical label fields and save. The unique, corroborated match becomes awaiting collection. A name alone, no match, duplicate claims or conflicting evidence remain in review without automatic assignment. Duplicate physical references are rejected. For split shipments use `BOX-002` with the same order ID.
4. As Asha, open Inbox, mark arrival read, open the parcel and request its OTP/QR. Note the OTP while switching accounts in the same instance. Do not reload: active secrets are deliberately not restored after a full restart.
5. As Mira, find the parcel, scan the current QR or enter its parcel-scoped OTP. Inspect the verified student and parcel on the separate confirmation screen. Explicitly confirm physical handover to create a retained receipt.
6. Search Closed parcels to reopen the receipt. Reload, sign in again and confirm history remains. The consumed credential cannot be reused.

Expected-order list/details include cancellation only while pending without linked parcels, tracking additions and multiple shipment views. Student parcel/history and inbox are scoped to their signed-in account. Staff screens include actionable dashboard counts, paginated search/filter/history, label scanning with manual fallback, reviewed intake, candidate evidence, reconciliation checklist/reason, holds, credential verification, explicit handover and audit history. Dashboard counts intentionally cover the latest 100 records; lists are paginated.

Automatic matching compares **identifier kind + namespace + value**, never merchant IDs with unrelated AWBs. It requires exactly one unconflicted candidate and independent label email/student-number corroboration. The OTHER shopping platform, or a match only in the generic OTHER carrier namespace, requires staff review. Reconciliation records a checklist and reason; no document uploads exist. A new relevant disputed claim holds assigned parcels and invalidates credentials. A reviewed resolution survives unrelated registrations; new relevant evidence triggers review again. Collected parcels cannot be reassigned.

Credentials are per parcel: six-digit OTP, PII-free versioned QR, ten-minute validity, one current issue, replacement revocation, five-failure invalidation. Verification is bound to the current credential, parcel revision and staff session for at most two minutes or the credential expiry. Verification never consumes or closes. Confirmation requires explicit physical handover plus a retry key. Successful retries return the original receipt, including after restart; mismatched keys/bodies, holds, stale revisions, expiry and already collected states produce distinct errors. The mock serializes these operations; **it proves neither server authorization nor database atomicity/concurrency**. Predictable demo credentials must be replaced by cryptographic backend issuance.

Synthetic orders, parcels, inbox/read state, audit and receipts persist via AsyncStorage. Displayed OTP/QR secrets, sessions and verification details are volatile; credentials are invalidated on restart. Issuance with the same key replays while the original credential is available in the same session; otherwise it rejects and requires an explicit replacement with a new key. Secrets are absent from storage/logs. External delivery is marked simulated separately from in-app availability and read state. Nothing is actually sent.

Verification commands, after both installs:

```powershell
cd contracts
npm.cmd run validate
npm.cmd run check
cd ..\mobile
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run export:web
npx.cmd playwright install chromium
npm.cmd run test:e2e
npm.cmd run export:native
npx.cmd expo install --check
```

The browser tests run against the production web export; run `export:web` before `test:e2e`. Screenshots are written to the ignored `.scratch/screenshots/` directory; traces/failure output are also ignored. Tests cover the complete journey, matching/ownership/credential/hold/retry safeguards, response-schema consistency, persisted history, validation, simulated network recovery and camera fallback UI. Actual camera decoding requires a separate physical-device test. Native exports check JS bundling, not a signed APK/IPA or native device execution.

Before backend work, independently review the draft contract and decide authoritative identity/SSO, staff evidence policy, carrier namespaces/normalization, merchant namespaces, secure issuance-replay retention, idempotency retention, pagination consistency and real notification delivery policy. Implement a later HTTP adapter against `MailroomService` in `mobile/src/api/service.ts`, whose request/response types come from generated operations. Screens call this interface; no HTTP adapter is connected. Backend work must add real authorization/ownership checks, schema validation, cryptographic secrets/hashing, rate limits, transactional handover/idempotency/uniqueness, durable database storage, retention and integration tests. Actual backend integration, server security, database concurrency and real notifications remain **NOT TESTED**. Stop for independent review before implementing them.

Dependency audit also requires review: the current `npm audit --omit=dev` reports 11 findings (3 high, 3 moderate, 5 low) through Expo/Router dependencies, including CLI/config tooling and Router's query-string decoder. The selected SDK-compatible dependency set is pinned by the lockfile. Resolve upstream advisories before deploying with real users or data.
