# Smart Mailroom refinement summary

Date: 15 November 2026

Branch: `arnav`

Status: implementation and automated verification complete; physical multi-phone acceptance remains.

## Scope

This pass completes live updates and refines the existing receiving, request, notification, collection and
account flows. The product still uses AWB/tracking requests, optional order IDs, reviewed label entry and the
existing collection-code/ID-card checks. OCR and order-ID-only registration were discussed separately and are
not implemented in this pass.

The earlier local setup selected the existing `arnav` branch, installed a separate Node 24 runtime, and prepared
dedicated development/test databases. These refinements did not reset development accounts, parcels or hostels.
Automated database tests and browser fixtures use only the separate local `smart_mailroom_test` database.

## Live updates

- Added an authenticated WebSocket companion to the existing HTTP API. It sends small refresh signals rather
  than parcel details, member contacts or OTPs. HTTP continues to enforce permissions and ownership for reads
  and writes.
- Members receive ordinary events affecting their own records. Staff receive operational events. Shared
  hostel changes notify all signed-in clients; the background worker notifies only the members (and staff) its
  jobs affected (changed in the WebSocket fix round, see `docs/REALTIME.md`).
- Successful local writes refresh immediately. A connected client no longer checks every screen once a second.
  A 15-second fallback covers disconnected sockets and failed reads.
- Reconnection triggers fresh reads to recover missed changes. The client backs off connection failures,
  responds to heartbeats, detects silent connections, closes in the background and reconnects on return.
- Logout, expired/revoked sessions, deactivation and role changes invalidate the socket. Tokens are sent in the
  first authentication frame, never in connection URLs. Frames, connection counts and slow-client buffers are
  bounded. Origin is not checked (React Native on Android always sends one; the token is in the first frame).
- A transport failure during native socket authentication or close is handled as a reconnectable failure,
  rather than an uncaught app error.

## Experience and edge cases fixed

| Scenario | Resulting behavior |
| --- | --- |
| Operator receives a parcel while member Home stays open | Parcel and arrival notice appear without reloading the app. |
| Operator hands over a parcel while member Home/code remains open | Handed-over parcels leave Home; Past shows them. A consumed code is removed even when other parcels remain waiting. |
| Another phone replaces or cancels the member's code | The old code disappears. A private metadata read checks identity/state/expiry without returning the OTP again. |
| A guard leaves a collection sheet open while another guard verifies the code | The open sheet updates to the verified state and shows the current parcel list. |
| A collection is replaced, cancelled, expired or completed elsewhere | The old staff sheet explains that it is inactive and offers Close, rather than retaining working verification/handover controls. |
| Two guards work with the same collection | They see current verification/collection state. The server's existing conditional transactions continue to prevent duplicate handover. |
| Some parcels are handed over and others remain | Only selected parcels move to Past. The used code is cleared; remaining parcels can be collected with a new code. |
| Five incorrect OTP checks cancel a collection | Both staff and member receive the resulting state update. Incorrect verification is a failed HTTP response that still commits an attempt counter, so it is explicitly broadcast. |
| Another parcel/code arrives while a staff sheet is already open | The new queue item is not silently marked as already displayed. It can be shown after the current sheet closes. |
| Parcel search has several loaded pages | All loaded pages refresh together, avoiding stale later pages and duplicate rows from combining an old page with a fresh first page. |
| A request or delivery OTP changes while the intake form is open | Lookup banners refresh while manually entered label fields remain intact. |
| A parcel save commits but its response is lost | Retry preserves the original UUID and original submitted details. Fields are locked for the uncertain retry, preventing a changed payload from being mistaken for a new successful save. |
| A user edits a form while a lookup/save/verification is running | The relevant busy controls are disabled; request drafts and handover selections are not silently replaced mid-action. |
| User signs out or switches accounts before a save response arrives | The late response cannot update the old screen, restore the previous user or clear the new account's action state. Sign-out clears the local account without waiting for a slow network response. |
| Another phone changes the same profile | Untouched fields update. Local unsaved fields remain local and are not accidentally overwritten or sent back as stale changes. |
| Navigation retains a previous tab | Inactive pages are explicitly hidden from display and accessibility, preserving their draft state without exposing overlapping controls. |
| Scanner is closed, reopened or loses focus | The camera component is released instead of leaving a hidden preview mounted. Duplicate/late scan callbacks are ignored while closed. |
| Initial Giveaway loading fails | The error/retry state is shown instead of an endless loading indicator. Notification read errors also have a retry path. |

The backend's existing tests also verify owner/role restrictions, masked-phone handling, ambiguous/conflicting
matches, duplicate intake retries, request expiry, collection expiry, five-attempt cancellation, atomic handover,
ID-card acknowledgement for missing/mismatching label names, and concurrent completion with only one winner.

## Test labels

Open [the printable label page](test-labels/labels.html) on a second screen or print it at 100% scale. It contains
four synthetic Code 128 labels:

| AWB | Carrier recognized by this app |
| --- | --- |
| EE987654321IN | India Post |
| D87654321 | DTDC |
| FMPP9876543210 | Ekart |
| SF1234567890 | Shadowfax |

The generator verifies each barcode image decodes to exactly the displayed AWB. Labels contain synthetic data,
do not represent verified shipments and do not create requests or parcels. The barcode reads only the AWB;
other printed label text is not extracted automatically. A previously used AWB can show a duplicate warning.

## Verification completed

| Check | Result |
| --- | --- |
| API tests | 73 passed |
| Client unit tests, including Expo Go dependency compatibility | 24 passed |
| HTTP browser journeys | 11 passed |
| Development-renderer/browser warning and motion checks | 2 passed |
| Total automated tests | 110 passed |
| API build and client typechecking | Passed |
| Client lint, contract generation/validation/generated consistency | Passed |
| API formatting and Git whitespace checks | Passed |
| Backend runtime dependency audit | No reported vulnerabilities |
| Generated barcode software decode checks | All four passed |

The browser tests include independent client contexts, an actual API restart, checking that healthy sockets
do not issue one-second reads, code replacement/cancellation, partial handover with two guard clients, a fake
camera lifecycle, a committed save followed by a deliberately lost response, profile synchronization with an
unsaved field, and signing into another account before a delayed profile-save response arrives.

The fake camera verifies preview lifecycle only. Software barcode decoding and browser emulation do not establish
that a physical Android/iPhone camera has scanned a label successfully.

## Final multi-phone checklist

Reload Expo Go once on each phone to load this version. Use an SDK-58-compatible Expo Go. Keep the API and Expo
server running, and connect all devices to the PC's Wi-Fi or the same hotspot. The current phone-facing API
health URL is `http://10.7.16.19:3000/healthz`; expect `{"ok":true}`. The Expo URL is
`exp://10.7.16.19:8081`. If the PC address changes, update `mobile/.env` and the saved Expo QR.

The seeded accounts are `member@college.example`, `operator@college.example` and `admin@college.example`, with
the setup password `Test12345` unless it was subsequently changed. Use a new college-domain test account for
testing registration. Verification/reset/invite codes are printed in the local API console/log; actual email
delivery is not configured in this local setup.

1. **Phone A as member; Phone B as operator.** Add a request with an unused test AWB. Scan the corresponding
   printed/on-screen label with Phone B, confirm the AWB/carrier/requested member, enter a shelf and save. Keep
   Phone A on Home; expect the arrival and notification automatically. Leave label contacts blank to test
   request matching independently of phone/email matching.
2. **Camera handling.** Deny camera permission and check the manual fallback. Then allow it in settings and
   try again. Close/reopen the scanner, rotate the phone and scan another label. Record the device/OS and the
   actual decoded value. Do not count manually typing an AWB as a camera pass.
3. **Delivery OTP.** Add another AWB request and courier OTP as the member. Keep the guard's lookup form open,
   change the request OTP from the member phone and confirm the guard sees the current value without losing
   typed label details.
4. **Collection.** Tap Collect now on A. B should receive the queue item. Try one incorrect code, then the
   correct code. Check the member's ID and hand over selected parcels. A should update without refresh; Past
   should contain only handed-over parcels.
5. **Partial handover.** Receive two parcels, hand over only one, and confirm the other remains waiting. The
   consumed code must no longer be displayed. Generate a new code for the remaining parcel.
6. **Same account on two phones.** Display a member's code on one phone, generate a replacement or cancel from
   the other, and confirm the first phone stops showing the old code. A guard holding the old sheet should see
   that it is inactive.
7. **Second guard if available.** Open the same collection on two guard devices. Verify on one and confirm the
   other updates. Complete on one; the other must not retain an active handover action or create a second receipt.
8. **Network/lifecycle.** Background or lock A while B receives a parcel; return to A and expect fresh data.
   Turn Wi-Fi off and back on, then repeat the flow. Confirm the UI catches up without signing into the wrong
   account or requiring an app restart.
9. **Account isolation.** Sign out and into a different member; no previous member's parcels, code, profile
   draft or notifications should appear. Update the same member's profile from a second phone while keeping
   a different unsaved field on the first; confirm that unsaved field survives.
10. **Unmatched/admin checks.** Repeat masked-phone unmatched assignment, hostel management and an operator
    invitation. Confirm their screens and totals refresh automatically.

For a failure, record the step, device/OS, account role, AWB, expected/actual result and any Reference line.
Capture a screenshot; do not share real passwords, bearer tokens or private label photos.

## Remaining limits

Physical phone execution, camera permissions/decoding and the actual Wi-Fi network still need the checklist above.
The WebSocket hub supports the existing single API process; several API instances require shared pub/sub.
The local setup still uses console email codes. OCR, merchant-order-to-AWB lookup, order-ID-only registration,
real email-provider setup and deployment are separate from this experience-refinement pass.
