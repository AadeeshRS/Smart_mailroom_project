# Parcel identifiers and assisted label reading

Date: 15 November 2026

Status: Proposed plan only. No application implementation is included.

Baseline: `arnav`, commit `bad4528`.

## 1. Purpose and recommendation

Reduce the time guards spend receiving hundreds of parcels daily. The user clarified that students should be able to enter the identifier they find in their shopping app, especially the order ID, and that labels of interest are printed in English.

Build a hybrid workflow: exact barcode matching first, OCR for printed identifiers when needed, and optional recipient-field extraction for unmatched parcels. Keep the operator's review and the existing collection checks. Measure whether OCR reduces total intake time, including capture, upload, review and corrections.

The first task is to establish which identifier exists on both sides. An order ID identifies a purchase; an AWB/tracking number identifies a shipment or package. They are different identifier types. OCR reads visible text; it cannot derive a shopping order ID from an unrelated AWB when the order ID is absent. Amazon separately documents order IDs and carrier tracking IDs, and supports multiple package tracking IDs for one order. [Amazon identifier definitions](https://sellercentral.amazon.in/help/hub/reference/external/28151?locale=ta-IN), [Amazon multiple-package shipment confirmation](https://developer-docs.amazon/sp-api/lang-us/docs/confirm-the-shipment-status).

## 2. What the application actually does today

| Area | Current behavior | Implication |
| --- | --- | --- |
| Student request | `MemberRequests` requires AWB/tracking number; order ID is optional. `requests/service.ts` rejects recognized order-ID formats in the AWB field. | Order-ID-only registration needs a product, API and database change. |
| Barcode camera | `Scanner.tsx` returns decoded barcode text. It does not interpret other printed text. | The output could be an AWB, order ID, or another encoded reference. It depends on the particular barcode. |
| Code classification | `carrier.ts` recognizes Amazon-style and Flipkart-style order-ID patterns and a small set of AWB patterns. Other values default to AWB; numeric carrier formats can overlap. | Format inference is a hint, not proof of identifier type or carrier. |
| Request matching | `openRequest` tries an open request by exact AWB, otherwise a unique open request by exact order ID. | No Amazon-order-to-AWB translation or marketplace integration exists. |
| Contact matching | Phone/email matching follows request matching, with CONFLICT and AMBIGUOUS outcomes. | OCR errors in contact details could affect who gets a parcel; accepted fields need review. |
| Intake | Code and shelf are needed; label name, phone, email, hostel and room are optional. | With a matching request, guards can already save without typing all recipient details. |
| Request lifecycle | A request has one `parcelId` and becomes MATCHED on the first match. | Reusing an order registration for several packages requires a new lifecycle. |
| Handover | Collection uses the member's code; a missing or mismatched label name requires the ID-card acknowledgement. | Omitting label details must preserve that collection check. |

Relevant files: `mobile/src/Scanner.tsx`, `mobile/src/screens/operator/Scan.tsx`, `mobile/src/screens/operator/IntakeForm.tsx`, `mobile/src/screens/member/Requests.tsx`, `api/src/modules/requests/service.ts`, `api/src/modules/parcels/service.ts`, `api/src/modules/parcels/matching.ts`, `api/src/modules/collection/service.ts`, `contracts/openapi.yaml`.

The previous plan's decision L3 excludes OCR. This document proposes a later extension in response to the user's request. When implementation is authorized, record the revised decision and update the existing implementation plan and stack ADR together.

## 3. First decision gate: inspect actual identifiers

Before implementing OCR, examine roughly 20 representative parcels from the mailroom's actual carrier mix. For each parcel, compare the student's shopping-app order ID, available tracking ID, decoded barcode values, and printed label text. Obtain permission before collecting identifiable material; use redacted or synthetic equivalents in committed fixtures.

Record:

- Is the student's order ID printed anywhere on the external label?
- Is it encoded in a barcode, or is only the AWB encoded?
- Are there several barcodes, including routing, product or invoice references?
- Can the student access/copy the tracking number in the app or dispatch information?
- Are there multiple packages for the same order ID?
- Are recipient phone/email values complete, masked, or absent?

Use these results to choose the least costly useful path:

| Observed case | Intake path |
| --- | --- |
| Student registers tracking ID; barcode contains that tracking ID | Existing barcode/request matching. Improve the UI to show the fast path. OCR is unnecessary for this parcel. |
| Student registers order ID; barcode contains that exact order ID | Support order-ID-only requests, then use barcode matching. OCR is unnecessary. |
| Student registers order ID; label prints it, but barcode contains only AWB | Read the printed order ID with OCR, preserve the barcode AWB, review, then match. |
| Student registers order ID; neither barcode nor visible text contains it | Ask the student to add tracking information, or use the existing reviewed contact/manual-assignment path. OCR cannot fill the missing relationship. |
| Several plausible codes or conflicting identifiers | Ask the operator to select/correct the identifier. Do not guess or silently choose the first number. |

No public lookup that accepts any student's order ID and returns their shipping details is assumed. Amazon's seller APIs require appropriate selling-partner authorization; they are not a general mailroom lookup service. [Amazon package-tracking prerequisites](https://developer-docs.amazon/sp-api/docs/retrieve-package-tracking-details).

Exit gate: demonstrate the common identifier on real app/label pairs. If barcode matching covers the requirement adequately, implement the request/UI improvements before considering OCR.

## 4. Intended operator and student flows

### Student

Let the student identify the source and enter an order ID, tracking ID, or both, with clear separate labels. Explain which value is useful when an order ID is not present on the package. An order registered before dispatch can gain tracking numbers later. Delivery OTP remains associated with the appropriate incoming shipment, rather than being reused automatically for every package in an order.

### Operator fast path

1. Scan the package barcode.
2. Run the existing lookup and show duplicate warnings and the matching member/request.
3. If the identifier resolves safely, keep optional label fields collapsed, retain the previous shelf, and let the operator review and save.
4. Preserve collection-code verification and ID-card checks. A successful request lookup is not proof of ownership by itself.

### Operator assisted path

1. Choose **Read label photo** if the barcode does not resolve the student's registered identifier, or the operator wants help reading recipient details.
2. Photograph the relevant label, rotate/crop if needed, and preview it. Capture follows an explicit action, rather than OCR on every live camera frame.
3. OCR suggests printed order IDs and AWBs first. Recipient name and complete phone/email are secondary suggestions. Hostel/room can follow when useful. Shelf remains the guard's choice.
4. Keep barcode and OCR identifiers visibly distinguished. If they conflict for the same identifier type, require correction or a retake. An AWB and an order ID having different values is normal.
5. Select or confirm the correct identifier and run an exact lookup. Show the image alongside editable suggestions. Low-confidence or ambiguous values remain suggestions until selected.
6. Confirm the accepted identifier and contact details, then save through the ordinary intake operation. OCR recognition or lookup alone creates no parcel, consumes no request and sends no notification.

For the first implementation, add photo reading to the existing intake form. A later usability improvement can keep one camera open to collect the barcode and a still photo, subject to device testing. Do not promise that one barcode contains every required field.

## 5. Identifier and matching changes required for order-ID-only entry

Implement these only if the intended product supports order-ID-only registration; they are independent of whether OCR is needed.

1. Update the contract to accept at least one identifier. Make AWB nullable where appropriate, and add the shopping source/merchant for order IDs. Keep merchant separate from courier: an Amazon order can use another delivery company.
2. Normalize each identifier consistently on student entry, barcode intake, OCR acceptance and manual entry. Preserve significant characters. Only add punctuation-tolerant comparison rules for formats verified in fixtures. Do not silently replace O/0, I/1 or similar OCR confusions.
3. Match an exact known carrier/tracking identity first, then an exact merchant/order identity. Existing requests without issuer information need conservative compatibility rules; unknown issuers must not create cross-merchant matches.
4. When AWB and order ID point to different members, flag a conflict instead of letting the first lookup win. Multiple distinct claimants also require review. Fuzzy matches can be displayed for investigation but cannot assign ownership or disclose another member's details to a student.
5. Add an order registration that can relate to multiple physical parcels. Preserve existing AWB requests and migrate current request-to-parcel associations additively. Do not mark an order fully received merely because its first package arrived. Use explicit completion, cancellation or expiry when the total package count is unknown.
6. Keep physical-package identity separate from order identity. A repeated order ID can be a legitimate split shipment; a repeated scan of the same physical package should warn. When AWB is missing, repeated order-ID intake needs explicit operator review rather than a blanket duplicate rule.
7. Make matching atomic under concurrent intake and registration. Existing conditional parcel assignment, audit and notification transactions remain the foundation. An identifier newly added by the student should recheck eligible unassigned parcels without transferring already assigned or collected ones.
8. Scope a courier delivery OTP to the request/shipment it belongs to and clear it on use. An order with several packages must not repeatedly reveal a previously consumed delivery OTP.

Tests and migration design must settle these semantics before OCR is attached. Making AWB optional alone is insufficient.

## 6. OCR architecture

Recommended first evaluation: Tesseract.js on Node 24, English language data, behind the existing authenticated Fastify API. Tesseract.js documents browser and Node execution; the app's Expo Go requirement makes server processing the practical initial choice. It should not be assumed to run unchanged inside React Native. [Tesseract.js runtime and engine scope](https://github.com/naptha/tesseract.js).

```text
Expo Go camera -> cropped/compressed label photo -> authenticated API
  -> bounded OCR worker -> identifier/recipient candidates
  -> operator review -> exact request lookup -> ordinary parcel intake
```

Use the installed `expo-camera` for still capture. Evaluate `expo-image-manipulator` for crop, rotation and resizing; it is included in Expo Go but is not currently a direct app dependency. Any future addition follows the repo's `npx expo install` rule and Expo Go compatibility test. [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/), [Expo ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/).

Evaluate `sharp` for server image validation/preprocessing. Keep preprocessing and recognition off the API's event loop. A long-lived OCR child process can own a Tesseract worker; start with one active worker and a small bounded queue, then size from peak-load measurements. Reuse initialized workers and bundled/cached language data. Recycle workers periodically and terminate/replace a worker that exceeds its deadline. A client abort must also cancel queued work; a timeout promise alone must not leave recognition running. Tesseract documents worker reuse, memory costs and periodic recycling. [Performance guidance](https://github.com/naptha/tesseract.js/blob/master/docs/performance.md), [Worker lifecycle](https://github.com/naptha/tesseract.js/blob/master/docs/workers_vs_schedulers.md).

A separate process improves failure recovery but still shares its host/container's CPU and RAM. If hosting cannot support OCR alongside login, collection and the background worker, isolate OCR in a separately sized service or leave it disabled there. Native Tesseract can be benchmarked behind the same interface if the initial evaluation is inadequate; it adds deployment/system-binary work and is not an automatic accuracy fix.

## 7. Extraction pipeline and safeguards

1. Validate encoded byte length, decoded format, signature and dimensions. Accept one JPEG/PNG label image; do not accept arbitrary remote image URLs, PDFs, archives or client filesystem paths.
2. Normalize orientation, crop irrelevant surroundings, preserve readable character detail and strip metadata. Try contrast/grayscale or deskewing only where measured useful. Do not threshold every image indiscriminately; it can erase thin print.
3. Benchmark page segmentation for a cropped label versus a sparse layout. English is the initial language. No custom model training is proposed before ordinary capture and preprocessing have been evaluated. Tesseract's documentation emphasizes image quality, skew and suitable segmentation. [Tesseract image-quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html).
4. Request word/block information explicitly from the selected Tesseract.js API version, rather than assuming it is enabled by default. Retain layout long enough to associate identifiers with headings such as Order ID, Order No, AWB or Tracking ID. [Recognition outputs](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).
5. Extract ranked, typed identifier candidates. Reject invoice numbers, prices, PIN codes, SKU/product codes and routing numbers as order identifiers unless there is positive contextual evidence. Unknown formats remain unknown rather than being silently classed as AWB.
6. Treat names and contacts within the delivery/consignee block separately from sender, seller, return-address and customer-care blocks. Reuse the existing Indian phone normalization after acceptance. Masked digits stay masked; never reconstruct them or turn a sender's number into the recipient's contact.
7. Return field-level uncertainty and ambiguity, with a short source snippet where useful. Engine confidence is not a calibrated probability that the value or recipient is correct. An exact database hit also does not prove that the operator photographed the correct package.
8. Preserve manually edited fields if recognition is retried. Discard stale results after another parcel, retake, cancellation, logout or account change. The reviewed draft retains one client-generated intake UUID across save retries.

## 8. Proposed API and integration points

Add a contract-first operator/admin operation such as `POST /v1/parcels/label-extractions`. It returns suggestions, never a saved parcel or an ownership assignment. Extend the route-by-role test matrix, error envelope and generated types before implementing the handler.

For a small initial label upload, bounded base64 JSON fits the current JSON-only contract/client architecture. Proposed initial limits: 2 MiB decoded image, 6 megapixels, with a 3 MiB limit on this operation only. Base64 adds roughly one third to transport size and creates extra memory copies, so include this overhead in benchmarks. Reject invalid base64 and decompression/pixel-limit abuse before recognition. Keep the ordinary API body limit at its current 32 KiB. Multipart uploads can be evaluated later if measurements justify extending the router, client and contract tooling.

Return an extraction reference, processing time, a list of typed identifier candidates, optional recipient-field candidates, and warnings such as unreadable, masked or ambiguous. Keep full OCR text and source images out of ordinary responses where unnecessary. A low-quality image is a normal retake/manual-entry outcome; unavailable processing or a full queue gets a retryable operational error.

The HTTP client currently has a global 15-second timeout and the router assumes JSON bodies. Add a bounded timeout for the OCR operation if the measured end-to-end budget requires it; do not slow every API call. Specify upload, queue-wait and recognition deadlines separately. Start with a short queue-wait budget and a hard recognition deadline around ten seconds, subject to feasibility results. Authentication/role checks precede expensive decoding; rate limits distinguish operators sharing campus Wi-Fi. OCR is read-only with respect to parcels and requests, but may update operational quota counters.

Expected future file areas:

| Area | Planned work |
| --- | --- |
| `contracts/openapi.yaml`, generated contract files | Optional-AWB/order registration changes, OCR request/result, error examples and permissions |
| `api/src/modules/requests/`, `parcels/`, Prisma schema/migrations | Identifier semantics, split shipments, exact matching, compatible migrations |
| Proposed `api/src/modules/label-reading/` | Validation, preprocessing, worker lifecycle and deterministic candidate parsing |
| `api/src/app.ts`, `api/src/core/config.ts`, `api/src/server.ts` | Operation-specific size limit, lifecycle shutdown, feature flag and operational limits |
| `mobile/src/screens/operator/`, proposed label-camera/review components | Photo capture, review, fast matched-request path and fallback |
| `mobile/src/screens/member/Requests.tsx`, `mobile/src/parcels.ts` | Clear identifier fields and order registration display |
| `mobile/src/api/http.ts` | Bounded upload/timeout support through the generated service |
| Privacy notice, README, deployment docs, stack ADR | Temporary photo handling, setup and revised product decisions |

## 9. Privacy and operations

Process photos temporarily; do not create a label-photo archive or write images/full OCR text to application logs, analytics, audit details or the database. Avoid gallery saves. Delete temporary app files after success, cancel, logout or expiry and clear abandoned captures on startup. If server temporary files are necessary, delete them on completion and failure and sweep abandoned files after crashes. Model/language caches contain model assets, not a photo history. Application cleanup is not a claim of forensic erasure of process memory.

Update the photo screen's explanation: the present barcode scanner says photos are not saved, whereas still capture uses app cache and server processing. Explain that distinction accurately. The ordinary accepted parcel fields continue under the existing retention policy; no new permanent image-retention policy is implied.

Record operational counts, latency, queue saturation, corrections by field type and worker restarts without retaining the field values. The repo targets Render Free, currently documented as 0.1 CPU and 512 MB; it also sleeps after idle periods. Those constraints make OCR performance uncertain until measured alongside the API. Do not assume the current hosting arrangement is sufficient. [Render compute plans](https://render.com/docs/compute-plans), [Free service limitations](https://render.com/docs/free).

Hundreds of parcels per day does not establish peak concurrency. Measure parcels per minute during courier arrivals, simultaneous guards, OCR fallback rate and retake rate. Use those figures to size processing and decide whether a separate host is needed. No hosting purchase or deployment is part of this plan.

## 10. Implementation phases and acceptance gates

| Phase | Deliverable | Gate before moving on |
| --- | --- | --- |
| 0. Identifier audit | App/label/barcode comparison across about 20 representative parcels; timed existing intake | Establish where the same identifier exists, and whether order-ID-only support and OCR are both needed. |
| 1. Request and fast-path design | Contract, schema/lifecycle proposal and reviewed screens for tracking/order IDs | Resolve split packages, ambiguous claims, issuer scope and missing-label identifiers. |
| 2. Isolated OCR feasibility | Local benchmark with roughly 100 permitted/synthetic label images, a held-out subset and recorded ground truth | Demonstrate useful exact identifier extraction, acceptable correction time and sustainable resource use before app integration. Keep repeated views of the same label out of different evaluation splits. |
| 3. Matching foundation | Compatible request/parcel changes, migrations and complete workflow tests | Barcode intake works for the chosen request model, including split parcels and reverse matching. |
| 4. Bounded OCR API | Authenticated suggestion-only operation, parser, worker limits and failure cleanup | No parcel/request side effects from extraction; hostile inputs and overload cannot exhaust the host under the tested limits. |
| 5. Mobile capture and review | Optional OCR on the existing intake form, explicit candidate review, preserved manual drafts | Runs in SDK 58 Expo Go; no silent code/contact replacement; barcode/manual intake stays available. |
| 6. Pilot and rollout | Small staff pilot, peak-load test, metrics and feature flag | Total intake time improves on representative traffic without observed wrong assignments; ordinary collection and login remain responsive. |

All phases after planning await implementation authorization. The first implementation experiment should be the isolated feasibility benchmark, after the identifier audit, rather than changing the running tester app.

### Test matrix

- Amazon-style/Flipkart-style order IDs, other formats with unknown type, numeric AWBs, several barcodes, invoice numbers and multiple printed identifiers.
- Barcode AWB plus printed order ID; both point to the same member, disagree, or match nobody.
- Barcode contains the registered order ID; barcode contains an AWB absent from the student's order-only registration; order ID entirely absent from the label.
- English thermal print, faded print, glare/tape, rotation, skew, folds, small text, blurry captures and damaged labels; multiple actual Android/iOS phones.
- Valid but incorrectly recognized digits, O/0 and I/1 ambiguities, absent or masked recipient phone, and sender/customer-care numbers near recipient details.
- Same order with two physical packages, repeat scan of one package, two claimants, late-added student tracking, concurrent guards and stale OCR responses.
- Role denial for members/public callers, expired sessions, oversized bodies, wrong file signatures, huge pixel dimensions, broken images, worker timeout/crash, cancellation, full queues and disabled OCR.
- Save retry retains one parcel UUID; OCR failure creates no parcel; notifications occur only on ordinary committed matching; collection codes and ID checks remain enforced.
- Existing contract validation, API and mobile suites, Expo Go dependency gate, HTTP browser journeys and development-renderer checks. Physical image quality/camera execution requires actual-device tests, not browser tests alone.

### Metrics and provisional release targets

Report exact identifier precision, extraction coverage and correction rate separately by format and capture condition. Report the fraction of labels where the student's order ID is physically present: missing text is not an OCR-recognition failure. Measure median and p95 capture-to-suggestion latency, end-to-end intake time, retake rate, peak RSS/CPU, peak throughput and the effect on other API requests.

Proposed targets to validate, not promised results: at least 40% lower median total assisted-intake time than the current fully typed path on comparable parcels; warm p95 suggestions within five seconds on the selected deployment; no observed incorrect assignments in the acceptance set; all uncertain/colliding identifiers routed to review. Also compare against the faster code-and-shelf baseline, so an OCR feature is not declared successful merely by comparing it with unnecessarily typing every field. A small test set cannot establish a production error probability: retain operator review and extend the pilot before claiming reliability.

If OCR does not meet these gates, ship the identifier/request improvements and barcode fast path first. Revisit capture setup, targeted region OCR, native Tesseract or another explicitly evaluated engine rather than forcing OCR into every intake.
