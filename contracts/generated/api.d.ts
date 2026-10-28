/** Generated from contracts/openapi.yaml. Do not edit manually. */

export interface paths {
    "/demo/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign in to a fixed provisioned demonstration account
         * @description Passcode is demonstration-only. Role is determined by the provisioned account; no client role input. Session lasts 30 minutes. No SSO or domain verification. Development builds/environments only; production deployments must omit this operation (404 DEMO_DISABLED), never accept the demo passcode.
         */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read current session
         * @description Read current session
         */
        get: operations["getSession"];
        put?: never;
        post?: never;
        /**
         * Revoke current session
         * @description Revoke current session
         */
        delete: operations["logout"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/guides/{platform}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Platform-specific order-ID guidance
         * @description Platform-specific order-ID guidance
         */
        get: operations["getGuide"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List owned expected orders
         * @description List owned expected orders
         */
        get: operations["listOrders"];
        put?: never;
        /**
         * Register expected order and re-evaluate stored parcels
         * @description Same student active platform/order duplicate: 409 DUPLICATE_ORDER. Cross-student overlapping claims retained as disputed, never first-claim allocation. New claims or tracking additions re-evaluate all unclosed relevant parcels, invalidate credentials and hold assigned parcels on new ambiguity/conflict. Late orders use identical matching safeguards. Required idempotencyKey. Scope is authenticated principal + operationId + key; canonical fingerprint includes path and semantic JSON body except the key, with sorted object keys. For 24 hours, same request replays the original response without repeating side effects, even if the current resource revision has changed; different body/path gives 409 IDEMPOTENCY_CONFLICT. Only successful writes retain results; validation/authorization/state errors do not reserve a key. Expired result entries may be removed and a later request treated as fresh, subject to domain constraints; clients must use a new key after 24 hours. Backend must commit resource changes and idempotency result together. A retry that changes data requires an explicit new operation and key, not silent mutation of an uncertain request.
         */
        post: operations["createOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an owned expected order
         * @description Read an owned expected order
         */
        get: operations["getOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/tracking": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Append a later carrier tracking reference
         * @description Append a later carrier tracking reference
         */
        post: operations["addTracking"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/cancellation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel only PENDING request with no linked parcels
         * @description Cancel only PENDING request with no linked parcels
         */
        post: operations["cancelOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/parcels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List authorized parcels including retained closed history
         * @description Students see only linked parcels they own, staff see all. Filters combine by AND; stable descending receivedAt/id order. Closed records retained.
         */
        get: operations["listParcels"];
        put?: never;
        /**
         * Save physical intake and evaluate trustworthy matching
         * @description Camera returns untrusted text only; fields must be classified and labelReviewed true. physicalReference uniquely identifies a physical parcel (not an order or shared tracking); duplicate intake returns 409 DUPLICATE_INTAKE. Save RECEIVED audit then resolve to AWAITING_MATCH or AWAITING_COLLECTION. Matching requires same kind, namespace and trimmed case-normalized value, exactly one unconflicted candidate, email or student-number corroboration and no conflicting supplied recipient or comparable identifier. Name alone never suffices. OTHER platform or a match only in the generic OTHER carrier namespace cannot auto-match. Separate physical references support split shipments. Required idempotencyKey. Scope is authenticated principal + operationId + key; canonical fingerprint includes path and semantic JSON body except the key, with sorted object keys. For 24 hours, same request replays the original response without repeating side effects, even if the current resource revision has changed; different body/path gives 409 IDEMPOTENCY_CONFLICT. Only successful writes retain results; validation/authorization/state errors do not reserve a key. Expired result entries may be removed and a later request treated as fresh, subject to domain constraints; clients must use a new key after 24 hours. Backend must commit resource changes and idempotency result together. A retry that changes data requires an explicit new operation and key, not silent mutation of an uncertain request. A normalized carrier/tracking value found on another physical reference, including a closed historical parcel, is TRACKING_COLLISION. Save the new physical record unassigned as AWAITING_MATCH/REVIEW; hold affected uncollected assignments as DISPUTE and invalidate credentials. Never alter closed history. Staff must explicitly document a resolution for each affected uncollected parcel. A reviewed collision resolution remains valid only for the recorded collision membership/evidence. Sharing a merchant order ID alone is allowed for split shipments.
         */
        post: operations["intakeParcel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/parcels/{parcelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read authorized parcel
         * @description Read authorized parcel
         */
        get: operations["getParcel"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/parcels/{parcelId}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect candidate evidence; staff only
         * @description Staff-only searchable candidates. Active comparable requests first, then createdAt descending and opaque ID descending. Default 20, maximum 50. Snapshot pagination rules below apply; all evidence decisions recheck current parcel revision. Returning a candidate never authorizes allocation.
         */
        get: operations["getReview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/parcels/{parcelId}/reconciliation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reconcile with evidence checklist and recorded reason
         * @description All checklist booleans true; reason at least 12 characters. expectedRevision must match. May resolve disputes or transfer an uncollected parcel with explicit audit and notifications; invalidates outstanding credentials. Cannot change CLOSED parcel ownership. Review policy is a proposed decision for independent approval; no screenshot/document upload. A resolved decision remains effective for the reviewed claims. New relevant claims or identifiers invalidate the reviewed evidence baseline and trigger a new hold; unrelated registrations do not. Required idempotencyKey. Scope is authenticated principal + operationId + key; canonical fingerprint includes path and semantic JSON body except the key, with sorted object keys. For 24 hours, same request replays the original response without repeating side effects, even if the current resource revision has changed; different body/path gives 409 IDEMPOTENCY_CONFLICT. Only successful writes retain results; validation/authorization/state errors do not reserve a key. Expired result entries may be removed and a later request treated as fresh, subject to domain constraints; clients must use a new key after 24 hours. Backend must commit resource changes and idempotency result together. A retry that changes data requires an explicit new operation and key, not silent mutation of an uncertain request.
         */
        post: operations["reconcileParcel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/parcels/{parcelId}/hold": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set or resolve collection hold with audit reason
         * @description Every change increments revision and invalidates credentials. DISPUTE can only be cleared by evidence-led reconciliation, not a simple hold change. CLOSED parcel records never transfer.
         */
        post: operations["setHold"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/parcels/{parcelId}/credentials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Issue or explicitly replace parcel collection credential
         * @description Student owner and eligible parcel only. 6-digit OTP and PII-free QR, one current credential, 10 minutes. Scope principal + issueCredential + key; metadata retained 24 hours. Same key/body replays only while the original current unexpired credential secrets remain in volatile issuance memory in that same authenticated session. Replacement, expiry, session change or process restart makes replay unavailable: 409 ISSUANCE_RETRY_UNAVAILABLE. After 24 hours the key may be fresh, but active-credential checks still apply. To recover explicitly choose replacement with replace=true and a NEW key; this invalidates prior OTP/QR/verification. No plaintext credential persistence is required or allowed in the mock. Future backend may retain an encrypted replay envelope for at most the issuance session/credential lifetime; hashes alone must never be presented as recoverable secrets. Responses and errors Cache-Control: no-store; secrets never appear in logs or list/detail endpoints.
         */
        post: operations["issueCredential"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/parcels/{parcelId}/verifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify OTP or QR without consuming credential
         * @description OTP requires six digits for this parcel; QR requires v=1, current credentialRef and opaque token for this parcel. No PII in QR. Five wrong well-formed OTP attempts invalidate current credential. Verification binds parcel, current credential, parcel revision and staff session. Expires at min(now+2 minutes, credential expiry). Does not close parcel or consume credential.
         */
        post: operations["verifyCredential"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/parcels/{parcelId}/handover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Explicitly confirm physical handover or replay original receipt
         * @description Staff only. Fresh authorization requires true physicalHandoverConfirmed and verification bound to current credential, parcel revision and STAFF SESSION; verification expires at min(2 minutes, credential expiry). Idempotency scope is staff ACCOUNT + confirmHandover + key; fingerprint includes exact parcelId, verificationId and physicalHandoverConfirmed. Persist the original request/key before attempting confirmation and keep it on uncertain outcome; never silently mint a fresh key. Replay lookup precedes verification/credential expiry and current lifecycle checks. A committed same-body result replays the original receipt after verification expiry, logout/login, process restart or CLOSED status. Different body/path gives 409 IDEMPOTENCY_CONFLICT. Handover mappings are retained for the lifetime of their retained receipt (stronger than ordinary 24-hour writes). Without a committed result, expired/missing verification gives 410 VERIFICATION_EXPIRED; it cannot create a handover. Holds/revision changes/credential changes/already-collected fresh attempts remain rejected. Recovery is account-scoped; no session token, OTP or QR secret is persisted by the client. Backend must atomically recheck, consume credential, close parcel, create one receipt and store idempotency result. Mock serialization is not database atomicity evidence.
         */
        post: operations["confirmHandover"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List owned persistent in-app inbox
         * @description List owned persistent in-app inbox
         */
        get: operations["listNotifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/{notificationId}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark owned in-app notification read
         * @description Mark owned in-app notification read
         */
        post: operations["readNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/receipts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search authorized retained handover receipts
         * @description Search authorized retained handover receipts
         */
        get: operations["listReceipts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/receipts/{receiptId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read authorized retained receipt
         * @description Read authorized retained receipt
         */
        get: operations["getReceipt"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/demo/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Explicitly reset synthetic demo data and revoke all sessions
         * @description Explicitly reset synthetic demo data and revoke all sessions Development builds/environments only; production must omit it (404 DEMO_DISABLED). Mock kernel can disable demo operations. Reset erases all synthetic records and idempotency results and revokes sessions; clients clear their confirmation recovery records.
         */
        post: operations["resetDemo"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/parcels/{parcelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read staff-only StaffParcel
         * @description Authenticated staff only. Includes internal evidence/audit metadata; student calls return FORBIDDEN.
         */
        get: operations["getStaffParcel"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/receipts/{receiptId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read staff-only StaffReceipt
         * @description Authenticated staff only. Includes internal evidence/audit metadata; student calls return FORBIDDEN.
         */
        get: operations["getStaffReceipt"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description Opaque prefixed identifier. Backend uses at least 128 bits from a cryptographically secure random generator, for example a prefix plus base64url encoding of 16 random bytes. Never derive IDs from frontend counters, names or database row counts. Counter IDs in the deterministic local demo are not a backend allocation scheme. */
        UserId: string;
        /** @description Opaque prefixed identifier. Backend uses at least 128 bits from a cryptographically secure random generator, for example a prefix plus base64url encoding of 16 random bytes. Never derive IDs from frontend counters, names or database row counts. Counter IDs in the deterministic local demo are not a backend allocation scheme. */
        OrderId: string;
        /** @description Opaque prefixed identifier. Backend uses at least 128 bits from a cryptographically secure random generator, for example a prefix plus base64url encoding of 16 random bytes. Never derive IDs from frontend counters, names or database row counts. Counter IDs in the deterministic local demo are not a backend allocation scheme. */
        ParcelId: string;
        /** @description Opaque prefixed identifier. Backend uses at least 128 bits from a cryptographically secure random generator, for example a prefix plus base64url encoding of 16 random bytes. Never derive IDs from frontend counters, names or database row counts. Counter IDs in the deterministic local demo are not a backend allocation scheme. */
        NotificationId: string;
        /** @description Opaque prefixed identifier. Backend uses at least 128 bits from a cryptographically secure random generator, for example a prefix plus base64url encoding of 16 random bytes. Never derive IDs from frontend counters, names or database row counts. Counter IDs in the deterministic local demo are not a backend allocation scheme. */
        CredentialId: string;
        /** @description Opaque prefixed identifier. Backend uses at least 128 bits from a cryptographically secure random generator, for example a prefix plus base64url encoding of 16 random bytes. Never derive IDs from frontend counters, names or database row counts. Counter IDs in the deterministic local demo are not a backend allocation scheme. */
        VerificationId: string;
        /** @description Opaque prefixed identifier. Backend uses at least 128 bits from a cryptographically secure random generator, for example a prefix plus base64url encoding of 16 random bytes. Never derive IDs from frontend counters, names or database row counts. Counter IDs in the deterministic local demo are not a backend allocation scheme. */
        ReceiptId: string;
        /**
         * Format: date-time
         * @description RFC3339 UTC timestamp; responses end in Z.
         */
        Timestamp: string;
        /**
         * @description Approved catalog. Canonical uppercase namespace keys only. AMAZON and MYNTRA order IDs: trim, case-sensitive, preserve punctuation. FLIPKART: trim and uppercase. OTHER: trim, case-sensitive and review-only. These are prototype comparison policies, not merchant integrations.
         * @enum {string}
         */
        Platform: "AMAZON" | "FLIPKART" | "MYNTRA" | "OTHER";
        /** @enum {string} */
        OrderStatus: "PENDING" | "MATCHED" | "CANCELLED";
        /** @enum {string} */
        ParcelStatus: "RECEIVED" | "AWAITING_MATCH" | "AWAITING_COLLECTION" | "CLOSED";
        /** @enum {string} */
        Hold: "NONE" | "REVIEW" | "DISPUTE";
        /** @enum {string} */
        MatchOutcome: "MATCHED" | "NO_MATCH" | "AMBIGUOUS" | "CONFLICT" | "DUPLICATE" | "INSUFFICIENT_EVIDENCE" | "TRACKING_COLLISION";
        /** @enum {string} */
        CredentialState: "NONE" | "ACTIVE" | "EXPIRED" | "INVALIDATED" | "CONSUMED";
        /** @enum {string} */
        ErrorCode: "VALIDATION" | "UNAUTHENTICATED" | "SESSION_EXPIRED" | "FORBIDDEN" | "NOT_FOUND" | "DUPLICATE_ORDER" | "DUPLICATE_INTAKE" | "CANCELLATION_INELIGIBLE" | "COLLECTION_HOLD" | "NOT_ELIGIBLE" | "CREDENTIAL_ACTIVE" | "ISSUANCE_RETRY_UNAVAILABLE" | "INVALID_CREDENTIAL" | "CREDENTIAL_EXPIRED" | "CREDENTIAL_INVALIDATED" | "ATTEMPTS_EXCEEDED" | "VERIFICATION_EXPIRED" | "REVISION_CHANGED" | "ALREADY_COLLECTED" | "CONCURRENT_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "NETWORK" | "PERSISTENCE" | "UNKNOWN_NAMESPACE" | "DEMO_DISABLED" | "CURSOR_INVALID";
        ErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"];
                message: string;
                requestId: string;
                retryable: boolean;
            };
        };
        Profile: {
            id: components["schemas"]["UserId"];
            name: string;
            /** Format: email */
            email: string;
            studentNumber?: string;
            /** @enum {string} */
            role: "STUDENT" | "STAFF";
        };
        Session: {
            token: string;
            profile: components["schemas"]["Profile"];
            expiresAt: components["schemas"]["Timestamp"];
        };
        LoginInput: {
            accountId: components["schemas"]["UserId"];
            passcode: string;
        };
        Ok: {
            ok: boolean;
        };
        Identifier: components["schemas"]["OrderIdentifier"] | components["schemas"]["TrackingReference"];
        TrackingReference: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "TRACKING";
            namespace: components["schemas"]["Carrier"];
            value: string;
        };
        CreateOrder: {
            platform: components["schemas"]["Platform"];
            merchantOrderId: string;
            tracking: components["schemas"]["TrackingReference"][];
            idempotencyKey: string;
        };
        AddTracking: {
            reference: components["schemas"]["TrackingReference"];
        };
        ExpectedOrder: {
            id: components["schemas"]["OrderId"];
            studentId: components["schemas"]["UserId"];
            platform: components["schemas"]["Platform"];
            merchantOrderId: string;
            tracking: components["schemas"]["TrackingReference"][];
            status: components["schemas"]["OrderStatus"];
            createdAt: components["schemas"]["Timestamp"];
            parcelIds: components["schemas"]["ParcelId"][];
            duplicateClaim: boolean;
        };
        IntakeInput: {
            identifiers: components["schemas"]["Identifier"][];
            recipientEmail: string;
            recipientStudentNumber: string;
            recipientName: string;
            description: string;
            storageLocation: string;
            physicalReference: string;
            /** @enum {string} */
            source: "MANUAL" | "CAMERA";
            labelReviewed: boolean;
            idempotencyKey: string;
        };
        AuditEvent: {
            at: components["schemas"]["Timestamp"];
            action: string;
            actorId: components["schemas"]["UserId"];
            reason: string;
        };
        /** @description Explicit public projection used by students and common parcel reads. matchExplanation and holdReason are allowlisted public messages, never label evidence, staff actor IDs or reconciliation free text. Staff details use getStaffParcel/getReview. */
        Parcel: {
            id: components["schemas"]["ParcelId"];
            description: string;
            storageLocation: string;
            physicalReference: string;
            status: components["schemas"]["ParcelStatus"];
            receivedAt: components["schemas"]["Timestamp"];
            orderId?: components["schemas"]["OrderId"];
            studentId?: components["schemas"]["UserId"];
            revision: number;
            matchOutcome: components["schemas"]["MatchOutcome"];
            /**
             * @description Allowlisted public status explanation only.
             * @enum {string}
             */
            matchExplanation: "Collected; retained receipt available." | "Mailroom review is required before collection." | "Matched parcel is ready for collection." | "Awaiting mailroom matching review.";
            hold: components["schemas"]["Hold"];
            /**
             * @description Generic public collection-hold explanation only.
             * @enum {string}
             */
            holdReason: "" | "Collection is paused pending mailroom review.";
            collectionEligible: boolean;
            credentialState: components["schemas"]["CredentialState"];
            receiptId?: components["schemas"]["ReceiptId"];
        };
        Candidate: {
            order: components["schemas"]["ExpectedOrder"];
            student: components["schemas"]["Profile"];
            comparable: boolean;
            corroborated: boolean;
            conflicts: string[];
        };
        ParcelReview: {
            parcel: components["schemas"]["StaffParcel"];
            candidates: components["schemas"]["Candidate"][];
            nextCursor?: string;
        };
        ReconcileInput: {
            orderId: components["schemas"]["OrderId"];
            expectedRevision: number;
            identifierReviewed: boolean;
            recipientVerified: boolean;
            conflictsResolved: boolean;
            reason: string;
            idempotencyKey: string;
        };
        HoldInput: {
            hold: components["schemas"]["Hold"];
            reason: string;
            expectedRevision: number;
        };
        Notification: {
            id: components["schemas"]["NotificationId"];
            studentId: components["schemas"]["UserId"];
            parcelId: components["schemas"]["ParcelId"];
            title: string;
            message: string;
            createdAt: components["schemas"]["Timestamp"];
            readAt?: components["schemas"]["Timestamp"];
            inAppAvailable: boolean;
            /** @enum {string} */
            externalDelivery: "PENDING" | "ACCEPTED" | "DELIVERED" | "FAILED";
            simulatedExternal: boolean;
        };
        IssueInput: {
            idempotencyKey: string;
            replace: boolean;
        };
        QrPayload: {
            /** @enum {integer} */
            v: 1;
            credentialRef: components["schemas"]["CredentialId"];
            token: string;
        };
        Credential: {
            id: components["schemas"]["CredentialId"];
            parcelId: components["schemas"]["ParcelId"];
            otp: string;
            qr: components["schemas"]["QrPayload"];
            issuedAt: components["schemas"]["Timestamp"];
            expiresAt: components["schemas"]["Timestamp"];
        };
        VerifyInput: components["schemas"]["OtpVerification"] | components["schemas"]["QrVerification"];
        Verification: {
            id: components["schemas"]["VerificationId"];
            parcelId: components["schemas"]["ParcelId"];
            credentialId: components["schemas"]["CredentialId"];
            parcelRevision: number;
            expiresAt: components["schemas"]["Timestamp"];
            student: components["schemas"]["Profile"];
            parcel: components["schemas"]["StaffParcel"];
        };
        ConfirmInput: {
            verificationId: components["schemas"]["VerificationId"];
            physicalHandoverConfirmed: boolean;
            idempotencyKey: string;
        };
        /** @description Public retained receipt projection. Staff actor and verification reference are excluded. */
        Receipt: {
            id: components["schemas"]["ReceiptId"];
            parcelId: components["schemas"]["ParcelId"];
            orderId: components["schemas"]["OrderId"];
            studentId: components["schemas"]["UserId"];
            confirmedAt: components["schemas"]["Timestamp"];
            storageLocation: string;
        };
        Confirmation: {
            receipt: components["schemas"]["StaffReceipt"];
            replayed: boolean;
        };
        Guide: {
            platform: components["schemas"]["Platform"];
            title: string;
            steps: string[];
            caution: string;
        };
        OrderPage: {
            items: components["schemas"]["ExpectedOrder"][];
            nextCursor?: string;
        };
        ParcelPage: {
            items: components["schemas"]["Parcel"][];
            nextCursor?: string;
        };
        NotificationPage: {
            items: components["schemas"]["Notification"][];
            nextCursor?: string;
        };
        ReceiptPage: {
            items: components["schemas"]["Receipt"][];
            nextCursor?: string;
        };
        /**
         * @description Approved catalog. Canonical uppercase namespace keys only. DELHIVERY and EKART: trim and uppercase identifier; BLUEDART: remove ASCII spaces, digits only, preserve leading zeros. OTHER: trim, case-sensitive, review-only. No other carrier namespace is accepted.
         * @enum {string}
         */
        Carrier: "DELHIVERY" | "BLUEDART" | "EKART" | "OTHER";
        OrderIdentifier: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "ORDER_ID";
            namespace: components["schemas"]["Platform"];
            value: string;
        };
        /** @description Staff-only physical label evidence, internal match/hold reasons and audit actors. Never returned by common or student parcel reads. */
        StaffParcel: {
            id: components["schemas"]["ParcelId"];
            identifiers: components["schemas"]["Identifier"][];
            recipientEmail: string;
            recipientStudentNumber: string;
            recipientName: string;
            description: string;
            storageLocation: string;
            physicalReference: string;
            /** @enum {string} */
            source: "MANUAL" | "CAMERA";
            status: components["schemas"]["ParcelStatus"];
            receivedAt: components["schemas"]["Timestamp"];
            orderId?: components["schemas"]["OrderId"];
            studentId?: components["schemas"]["UserId"];
            revision: number;
            matchOutcome: components["schemas"]["MatchOutcome"];
            matchExplanation: string;
            hold: components["schemas"]["Hold"];
            holdReason: string;
            collectionEligible: boolean;
            credentialState: components["schemas"]["CredentialState"];
            audit: components["schemas"]["AuditEvent"][];
            receiptId?: components["schemas"]["ReceiptId"];
        };
        StaffReceipt: {
            id: components["schemas"]["ReceiptId"];
            parcelId: components["schemas"]["ParcelId"];
            orderId: components["schemas"]["OrderId"];
            studentId: components["schemas"]["UserId"];
            staffId: components["schemas"]["UserId"];
            confirmedAt: components["schemas"]["Timestamp"];
            storageLocation: string;
            verificationId: components["schemas"]["VerificationId"];
        };
        OtpVerification: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            method: "OTP";
            otp: string;
        };
        QrVerification: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            method: "QR";
            qr: components["schemas"]["QrPayload"];
        };
    };
    responses: {
        /** @description Error envelope. HTTP mapping: 400 validation; 401 authentication/session; 403 role; 404 resource absent or not owned; 409 duplicate, lifecycle, revision, idempotency or concurrent conflict; 410 expired credential/verification; 423 collection hold; 429 five failed OTP attempts; 503 network/persistence. Operation descriptions define specific codes. */
        Error: {
            headers: {
                /** @description Required on all sensitive errors, including authentication and credential errors. */
                "Cache-Control"?: "no-store";
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    getGuide: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                platform: components["schemas"]["Platform"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Guide"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    listOrders: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
                q?: string;
                status?: components["schemas"]["OrderStatus"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderPage"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    createOrder: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateOrder"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExpectedOrder"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    getOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["schemas"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExpectedOrder"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    addTracking: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["schemas"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddTracking"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExpectedOrder"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    cancelOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["schemas"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExpectedOrder"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    listParcels: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
                q?: string;
                status?: components["schemas"]["ParcelStatus"];
                hold?: components["schemas"]["Hold"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ParcelPage"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    intakeParcel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IntakeInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffParcel"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    getParcel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                parcelId: components["schemas"]["ParcelId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Parcel"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    getReview: {
        parameters: {
            query?: {
                /** @description Case-insensitive substring of active order ID, tracking value, student name/email/student number. No match is selected automatically. */
                q?: string;
                limit?: number;
                cursor?: string;
            };
            header?: never;
            path: {
                parcelId: components["schemas"]["ParcelId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ParcelReview"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    reconcileParcel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                parcelId: components["schemas"]["ParcelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReconcileInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffParcel"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    setHold: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                parcelId: components["schemas"]["ParcelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HoldInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffParcel"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    issueCredential: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                parcelId: components["schemas"]["ParcelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IssueInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Credential"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    verifyCredential: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                parcelId: components["schemas"]["ParcelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VerifyInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Verification"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    confirmHandover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                parcelId: components["schemas"]["ParcelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfirmInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Confirmation"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    listNotifications: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationPage"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    readNotification: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                notificationId: components["schemas"]["NotificationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Notification"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    listReceipts: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReceiptPage"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    getReceipt: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                receiptId: components["schemas"]["ReceiptId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Receipt"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    resetDemo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    getStaffParcel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                parcelId: components["schemas"]["ParcelId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffParcel"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
    getStaffReceipt: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                receiptId: components["schemas"]["ReceiptId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description All authentication, credential, verification, confirmation, account-owned and staff evidence responses, including errors, MUST use no-store. Demo adapters have no HTTP cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffReceipt"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            410: components["responses"]["Error"];
            423: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
        };
    };
}
