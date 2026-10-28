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

Automatic matching compares **identifier kind + approved namespace + normalized value**, never merchant IDs with unrelated AWBs. Approved platforms are AMAZON, FLIPKART, MYNTRA and OTHER; carriers are DELHIVERY, BLUEDART, EKART and OTHER. Unknown keys are rejected. Amazon/Myntra IDs are trimmed and case-sensitive; Flipkart IDs and Delhivery/Ekart references are trimmed and uppercased; Bluedart references remove ASCII spaces, require digits and preserve leading zeros. OTHER is review-only. Matching requires exactly one unconflicted candidate and independent label email/student-number corroboration. Reused normalized tracking across physical references preserves the new intake unassigned and holds affected uncollected assignments. Each collision resolution needs its own staff checklist/reason. Split shipments sharing only a merchant order ID remain eligible. Closed history never transfers. No document uploads exist.

Credentials are per parcel: six-digit OTP, PII-free versioned QR, ten-minute validity, replacement revocation and five-failure invalidation. OTP and QR requests are mutually exclusive schemas, enforced in the mock. Verification binds current credential, parcel revision and staff session for at most two minutes or credential expiry; it never consumes or closes. Fresh confirmation requires valid verification and explicit physical handover. Before sending, the app saves the exact confirmation request/key under the authenticated staff account, without OTP/QR/session secrets. On uncertainty it preserves that request. Use **Recover original confirmation**, or after reload sign in as the same staff account and open the overview's recovery card. A committed result replays its receipt even after verification expiry/restart; an uncommitted expired authorization is rejected. A definitive rejection allows deliberate re-verification. The demo-only response-loss checkbox exercises this path. Handover idempotency mappings live as long as receipts. The mock serializes operations; **it proves neither server authorization nor database atomicity/concurrency**. Backend credentials and opaque IDs require cryptographic generation, not demo counters.

Synthetic orders, parcels, inbox/read state, staff audit and receipts persist via AsyncStorage. Common/student parcel and receipt responses use closed public projections; internal label evidence, staff actors and review free text are available only through staff operations. Public explanations are allowlisted and notifications never copy staff reasons. Displayed OTP/QR secrets and sessions are volatile; active credentials invalidate on restart. Issuance metadata lasts 24 hours but secret replay exists only while the original current credential is unexpired and available in the same session. Otherwise issuance returns ISSUANCE_RETRY_UNAVAILABLE; explicitly replace using a new key. No plaintext persistence is needed. The saved confirmation request contains a verification reference, not a credential secret. External delivery is persistently simulated ACCEPTED, independently of in-app availability/read state; nothing is sent.

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

The contract remains DRAFT pending independent approval. Its proposed decisions are explicit: principal/operation/key idempotency for registration/intake/reconciliation retains successful responses 24 hours; retries precede revision checks and reject changed bodies. Snapshot cursors freeze membership/order for 15 minutes, exclude concurrent inserts and recheck authorization on every page. Reconciliation candidates are searchable and paginated (default 20/max 50). Sensitive responses/errors require Cache-Control: no-store. Demo login/reset must be absent in production. Notification attempts persist separately from inbox/read state; acceptance is not delivery, provider results deduplicate by attempt/event ID and cannot change lifecycle/readAt. Backend IDs need at least 128 random bits. The contract includes validated success/error and negative examples. These choices are proposals for reviewer approval, not gaps for silent backend invention.

A future HTTP adapter implements `MailroomService` in `mobile/src/api/service.ts`, using generated operation types. No backend implementation or HTTP integration exists. Real authorization, cryptographic secrets/hashing, rate limits, atomic handover/idempotency/uniqueness, durable database storage and integration tests remain required. Actual backend integration, server security, database transactions/concurrency, physical camera decoding and native device execution remain **NOT TESTED**. Stop for independent review before backend work.

Dependency assessment: `npm audit --omit=dev` still reports 11 package findings (3 high, 3 moderate, 5 low), representing three upstream advisories and their dependent packages. Expo/Router are at the latest available SDK-55 patches. An accidentally peer-resolved Expo Font 58 package was replaced with SDK-compatible `expo-font@55.0.8`; `expo install --check`, exports and browser tests verify compatibility. No force-fix, SDK downgrade or unverified major-version override was applied.

| Remaining advisory/path | Reachability and compatible-fix assessment |
| --- | --- |
| [decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) 0.2.2 via `expo-router@55.0.18 -> query-string@7.1.3` | **Application runtime**, including Router URL/path query handling. Patched decoder is 0.5.0+ (latest checked 0.5.1), but it exports an ESM namespace while query-string 7 calls its CommonJS require result as a function. An isolated Node 24 probe reproduced TypeError with 0.5.1. No query-string 7 patch or Router 55 patch is available. Needs an upstream backport or reviewed compatible Router/SDK migration; not labelled development-only. |
| [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) 3.25.76 via `expo@55.0.32 -> @expo/cli@55.0.37` | Expo CLI development/build process: DevTools plugin output safeParse and MCP schema arrays are actual consumers. Untrusted third-party plugin output can reach those parsers. It is not an application service dependency. Upstream patch is 4.6.6; CLI requires `^3.25.76`, and 3.25.76 is the latest 3.x. A 4.x override is outside the CLI's supported range and requires upstream integration/API verification. |
| [deepmerge](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) 4.3.1 via `@expo/config@55.0.21` | Build/config tooling merges app configuration and plugin properties (Config.js); no application service import. Malicious configuration/plugin objects are the relevant input. Registry latest is 4.3.1 and the upstream advisory lists no patched release. An SDK-compatible published fix cannot currently be applied. |

These findings remain unresolved; the mock workflows and successful exports do not make a security-clean production deployment claim.
