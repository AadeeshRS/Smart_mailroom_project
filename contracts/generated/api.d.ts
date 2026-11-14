/** Generated from contracts/openapi.yaml. Do not edit manually. */

export interface paths {
    "/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a member account with a college email; emails a verification code
         * @description Only emails in the configured college domains are accepted. Registering an email that already exists returns the same 202 (no account enumeration): an unverified account is updated with these details and gets a fresh code; a verified one is left unchanged.
         */
        post: operations["register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/verify-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Verify the emailed code and start a session */
        post: operations["verifyEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/resend-code": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send a new verification code to an unverified account (always 202) */
        post: operations["resendCode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Email and password to a session
         * @description Wrong email and wrong password give the same UNAUTHENTICATED error. EMAIL_NOT_VERIFIED and ACCOUNT_DISABLED are returned only after the password matches.
         */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/forgot-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Email a password reset code (always 202) */
        post: operations["forgotPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/reset-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set a new password with the emailed code; revokes every session
         * @description Also how operators and admins invited by an admin set their first password.
         */
        post: operations["resetPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke the current session */
        delete: operations["logout"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hostels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Hostel list, including inactive ones (the registration dropdown shows active only) */
        get: operations["listHostels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The signed-in user's profile */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edit the allowed profile fields; email and name can't be changed
         * @description Send only the fields to change; `null` clears an optional field.
         */
        patch: operations["updateMe"];
        trace?: never;
    };
    "/me/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Change password; revokes the user's other sessions */
        post: operations["changePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List and search users by name, email, ID number or phone */
        get: operations["listUsers"];
        put?: never;
        /** Create an operator or admin; emails them a code to set their password */
        post: operations["createUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change a user's role or deactivate them (revokes their sessions)
         * @description An admin can't change their own role or deactivate themselves (SELF_CHANGE), and the last active admin can't be demoted or deactivated (LAST_ADMIN).
         */
        patch: operations["updateUser"];
        trace?: never;
    };
    "/admin/hostels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add a hostel */
        post: operations["createHostel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/hostels/{hostelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Rename or (de)activate a hostel */
        patch: operations["updateHostel"];
        trace?: never;
    };
    "/parcels/lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * What a scanned code is, its likely carrier, and parcels already logged with it
         * @description The code is normalised (trimmed, uppercase, spaces removed). `kind` tells an order ID from an AWB by pattern; `carrier` is null when the format doesn't identify one. The operator can override both before saving.
         */
        get: operations["lookupParcel"];
        put?: never;
        post?: never;
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
         * Search parcels, newest first (keyset pages)
         * @description `q` matches the AWB, order ID, label name, label phone, recipient name or shelf. `unmatched=true` keeps parcels with no recipient.
         */
        get: operations["listParcels"];
        put?: never;
        /**
         * Log a parcel from its label, then match it to a member
         * @description `id` is a UUID generated on the phone, so retrying the same intake returns the parcel already saved instead of creating a second one. At least one of `awb` and `orderId` is required. Matching links the parcel to the single verified member whose phone, alternate phone, college email or personal email matches the label; more than one sets matchFlag AMBIGUOUS.
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
        /** A parcel with its audit history */
        get: operations["getParcel"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/parcels/{parcelId}/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Link an unmatched parcel to a member by hand
         * @description Only parcels still in the mailroom with no recipient (else ALREADY_ASSIGNED or NOT_IN_MAILROOM).
         */
        post: operations["assignParcel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Find verified members by name, ID number, phone, room or email (at most 20) */
        get: operations["searchMembers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/parcels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The member's parcels in the mailroom (ready) or already collected or returned (history) */
        get: operations["listMyParcels"];
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
        Id: string;
        /** Format: email */
        Email: string;
        Password: string;
        Code: string;
        /** @description Any common format; stored as E.164 (+91 assumed for 10-digit numbers). */
        Phone: string;
        /** @enum {string} */
        Role: "MEMBER" | "OPERATOR" | "ADMIN";
        /** @enum {string} */
        MemberType: "STUDENT" | "STAFF";
        Name: string;
        IdNumber: string;
        Room: string;
        Ok: {
            /** @enum {boolean} */
            ok: true;
        };
        RegisterInput: {
            email: components["schemas"]["Email"];
            password: components["schemas"]["Password"];
            name: components["schemas"]["Name"];
            memberType: components["schemas"]["MemberType"];
            idNumber: components["schemas"]["IdNumber"];
            phone: components["schemas"]["Phone"];
            altPhone?: components["schemas"]["Phone"];
            personalEmail?: components["schemas"]["Email"];
            hostelId?: components["schemas"]["Id"];
            roomNumber?: components["schemas"]["Room"];
        };
        VerifyEmailInput: {
            email: components["schemas"]["Email"];
            code: components["schemas"]["Code"];
        };
        EmailInput: {
            email: components["schemas"]["Email"];
        };
        LoginInput: {
            email: components["schemas"]["Email"];
            password: string;
        };
        ResetPasswordInput: {
            email: components["schemas"]["Email"];
            code: components["schemas"]["Code"];
            password: components["schemas"]["Password"];
        };
        ChangePasswordInput: {
            currentPassword: string;
            newPassword: components["schemas"]["Password"];
        };
        UpdateMeInput: {
            memberType?: components["schemas"]["MemberType"];
            idNumber?: components["schemas"]["IdNumber"];
            phone?: components["schemas"]["Phone"];
            altPhone?: string | null;
            /** Format: email */
            personalEmail?: string | null;
            hostelId?: string | null;
            roomNumber?: string | null;
        };
        CreateUserInput: {
            email: components["schemas"]["Email"];
            name: components["schemas"]["Name"];
            /** @enum {string} */
            role: "OPERATOR" | "ADMIN";
        };
        UpdateUserInput: {
            role?: components["schemas"]["Role"];
            active?: boolean;
        };
        CreateHostelInput: {
            name: components["schemas"]["Name"];
        };
        UpdateHostelInput: {
            name?: components["schemas"]["Name"];
            active?: boolean;
        };
        User: {
            id: components["schemas"]["Id"];
            role: components["schemas"]["Role"];
            email: string;
            name: string;
            active: boolean;
            emailVerified: boolean;
            /** @enum {string|null} */
            memberType: "STUDENT" | "STAFF" | null;
            idNumber: string | null;
            phone: string | null;
            altPhone: string | null;
            personalEmail: string | null;
            hostelId: string | null;
            hostelName: string | null;
            roomNumber: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        UserPage: {
            items: components["schemas"]["User"][];
            nextCursor?: components["schemas"]["Id"];
        };
        Session: {
            token: string;
            /** Format: date-time */
            expiresAt: string;
            user: components["schemas"]["User"];
        };
        Hostel: {
            id: components["schemas"]["Id"];
            name: string;
            active: boolean;
        };
        HostelList: {
            items: components["schemas"]["Hostel"][];
        };
        Code60: string;
        /** @enum {string} */
        Carrier: "DELHIVERY" | "BLUEDART" | "EKART" | "AMAZON" | "DTDC" | "XPRESSBEES" | "SHADOWFAX" | "INDIA_POST" | "OTHER";
        /** @enum {string} */
        CodeKind: "AWB" | "ORDER_ID";
        /** @enum {string} */
        ParcelStatus: "IN_MAILROOM" | "COLLECTED" | "RETURNED";
        IntakeInput: {
            /** Format: uuid */
            id: string;
            awb?: components["schemas"]["Code60"];
            orderId?: components["schemas"]["Code60"];
            carrier?: components["schemas"]["Carrier"];
            labelName?: string;
            /** @description Kept only if it's a valid number */
            labelPhone?: string;
            labelEmail?: string;
            labelHostel?: string;
            labelRoom?: string;
            shelf: string;
            note?: string;
        };
        AssignInput: {
            userId: components["schemas"]["Id"];
        };
        MemberSummary: {
            id: components["schemas"]["Id"];
            name: string;
            email: string;
            idNumber: string | null;
            phone: string | null;
            hostelName: string | null;
            roomNumber: string | null;
        };
        MemberList: {
            items: components["schemas"]["MemberSummary"][];
        };
        OperatorParcel: {
            id: string;
            awb: string | null;
            orderId: string | null;
            /** @enum {string|null} */
            carrier: "DELHIVERY" | "BLUEDART" | "EKART" | "AMAZON" | "DTDC" | "XPRESSBEES" | "SHADOWFAX" | "INDIA_POST" | "OTHER" | null;
            labelName: string | null;
            labelPhone: string | null;
            labelEmail: string | null;
            labelHostel: string | null;
            labelRoom: string | null;
            shelf: string;
            note: string | null;
            status: components["schemas"]["ParcelStatus"];
            /** @description The linked member, or null (Ajv needs nullable next to type, so this repeats MemberSummary) */
            recipient: {
                id: components["schemas"]["Id"];
                name: string;
                email: string;
                idNumber: string | null;
                phone: string | null;
                hostelName: string | null;
                roomNumber: string | null;
            } | null;
            /** @enum {string|null} */
            matchSource: "REQUEST" | "CONTACT" | "MANUAL" | null;
            /** @enum {string|null} */
            matchFlag: "AMBIGUOUS" | "CONFLICT" | null;
            /** Format: date-time */
            receivedAt: string;
            /** @description The operator's name */
            receivedBy: string;
            /** Format: date-time */
            collectedAt: string | null;
        };
        ParcelPage: {
            items: components["schemas"]["OperatorParcel"][];
            nextCursor?: components["schemas"]["Id"];
        };
        ParcelDetail: {
            parcel: components["schemas"]["OperatorParcel"];
            history: {
                /** Format: date-time */
                at: string;
                actor: string;
                action: string;
                detail: string;
            }[];
        };
        Lookup: {
            code: string;
            kind: components["schemas"]["CodeKind"];
            /** @enum {string|null} */
            carrier: "DELHIVERY" | "BLUEDART" | "EKART" | "AMAZON" | "DTDC" | "XPRESSBEES" | "SHADOWFAX" | "INDIA_POST" | "OTHER" | null;
            /** @description Parcels already logged with this code, newest first (at most 5). Non-empty means a likely duplicate. */
            existing: components["schemas"]["OperatorParcel"][];
        };
        MyParcel: {
            id: string;
            awb: string | null;
            orderId: string | null;
            carrier: string | null;
            status: components["schemas"]["ParcelStatus"];
            /** Format: date-time */
            receivedAt: string;
            /** Format: date-time */
            collectedAt: string | null;
        };
        MyParcelList: {
            items: components["schemas"]["MyParcel"][];
        };
        /** @enum {string} */
        ErrorCode: "VALIDATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "EMAIL_NOT_VERIFIED" | "ACCOUNT_DISABLED" | "EMAIL_DOMAIN_NOT_ALLOWED" | "CODE_INVALID" | "PHONE_TAKEN" | "ID_NUMBER_TAKEN" | "EMAIL_TAKEN" | "NAME_TAKEN" | "LAST_ADMIN" | "SELF_CHANGE" | "ALREADY_ASSIGNED" | "NOT_IN_MAILROOM" | "RATE_LIMITED" | "NETWORK" | "INTERNAL";
        ErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"];
                message: string;
                requestId: string;
                retryable: boolean;
            };
        };
    };
    responses: {
        /** @description Done */
        Ok: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Ok"];
            };
        };
        /** @description Accepted; any email is sent in the background of this request */
        Accepted: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Ok"];
            };
        };
        /** @description A new session */
        Session: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Session"];
            };
        };
        /** @description A user */
        User: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["User"];
            };
        };
        /** @description A parcel as operators see it */
        Parcel: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["OperatorParcel"];
            };
        };
        /** @description A hostel */
        Hostel: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Hostel"];
            };
        };
        /** @description Error envelope. 400 validation or bad code; 401 not signed in; 403 role, unverified or disabled; 404 absent or not owned; 409 conflict; 429 rate limited; 500 unexpected. */
        Error: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
    };
    parameters: {
        Q: string;
        Cursor: components["schemas"]["Id"];
        Limit: number;
        ParcelId: components["schemas"]["Id"];
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterInput"];
            };
        };
        responses: {
            202: components["responses"]["Accepted"];
            default: components["responses"]["Error"];
        };
    };
    verifyEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VerifyEmailInput"];
            };
        };
        responses: {
            200: components["responses"]["Session"];
            default: components["responses"]["Error"];
        };
    };
    resendCode: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmailInput"];
            };
        };
        responses: {
            202: components["responses"]["Accepted"];
            default: components["responses"]["Error"];
        };
    };
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
            200: components["responses"]["Session"];
            default: components["responses"]["Error"];
        };
    };
    forgotPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmailInput"];
            };
        };
        responses: {
            202: components["responses"]["Accepted"];
            default: components["responses"]["Error"];
        };
    };
    resetPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResetPasswordInput"];
            };
        };
        responses: {
            200: components["responses"]["Ok"];
            default: components["responses"]["Error"];
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
            200: components["responses"]["Ok"];
            default: components["responses"]["Error"];
        };
    };
    listHostels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Hostels sorted by name */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HostelList"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["User"];
            default: components["responses"]["Error"];
        };
    };
    updateMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMeInput"];
            };
        };
        responses: {
            200: components["responses"]["User"];
            default: components["responses"]["Error"];
        };
    };
    changePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePasswordInput"];
            };
        };
        responses: {
            200: components["responses"]["Ok"];
            default: components["responses"]["Error"];
        };
    };
    listUsers: {
        parameters: {
            query?: {
                q?: components["parameters"]["Q"];
                role?: components["schemas"]["Role"];
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of users sorted by name */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserPage"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    createUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateUserInput"];
            };
        };
        responses: {
            200: components["responses"]["User"];
            default: components["responses"]["Error"];
        };
    };
    updateUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                userId: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateUserInput"];
            };
        };
        responses: {
            200: components["responses"]["User"];
            default: components["responses"]["Error"];
        };
    };
    createHostel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateHostelInput"];
            };
        };
        responses: {
            200: components["responses"]["Hostel"];
            default: components["responses"]["Error"];
        };
    };
    updateHostel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                hostelId: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateHostelInput"];
            };
        };
        responses: {
            200: components["responses"]["Hostel"];
            default: components["responses"]["Error"];
        };
    };
    lookupParcel: {
        parameters: {
            query: {
                code: components["schemas"]["Code60"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Lookup result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Lookup"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listParcels: {
        parameters: {
            query?: {
                q?: components["parameters"]["Q"];
                status?: components["schemas"]["ParcelStatus"];
                unmatched?: boolean;
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of parcels */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ParcelPage"];
                };
            };
            default: components["responses"]["Error"];
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
            200: components["responses"]["Parcel"];
            default: components["responses"]["Error"];
        };
    };
    getParcel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                parcelId: components["parameters"]["ParcelId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Parcel and history, oldest event first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ParcelDetail"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    assignParcel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                parcelId: components["parameters"]["ParcelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssignInput"];
            };
        };
        responses: {
            200: components["responses"]["Parcel"];
            default: components["responses"]["Error"];
        };
    };
    searchMembers: {
        parameters: {
            query: {
                q: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Matching members, by name */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberList"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listMyParcels: {
        parameters: {
            query: {
                view: "ready" | "history";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Newest first; history shows the latest 100 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyParcelList"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
}
