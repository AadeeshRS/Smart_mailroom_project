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
        /** @enum {string} */
        ErrorCode: "VALIDATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "EMAIL_NOT_VERIFIED" | "ACCOUNT_DISABLED" | "EMAIL_DOMAIN_NOT_ALLOWED" | "CODE_INVALID" | "PHONE_TAKEN" | "ID_NUMBER_TAKEN" | "EMAIL_TAKEN" | "NAME_TAKEN" | "LAST_ADMIN" | "SELF_CHANGE" | "RATE_LIMITED" | "NETWORK" | "INTERNAL";
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
}
