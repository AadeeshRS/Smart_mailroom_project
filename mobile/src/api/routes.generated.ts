// Generated from contracts/openapi.yaml. Do not edit.
export const routes = {
  "register": {
    "method": "POST",
    "path": "/auth/register",
    "query": [],
    "body": true
  },
  "verifyEmail": {
    "method": "POST",
    "path": "/auth/verify-email",
    "query": [],
    "body": true
  },
  "resendCode": {
    "method": "POST",
    "path": "/auth/resend-code",
    "query": [],
    "body": true
  },
  "login": {
    "method": "POST",
    "path": "/auth/login",
    "query": [],
    "body": true
  },
  "forgotPassword": {
    "method": "POST",
    "path": "/auth/forgot-password",
    "query": [],
    "body": true
  },
  "resetPassword": {
    "method": "POST",
    "path": "/auth/reset-password",
    "query": [],
    "body": true
  },
  "logout": {
    "method": "DELETE",
    "path": "/auth/session",
    "query": [],
    "body": false
  },
  "listHostels": {
    "method": "GET",
    "path": "/hostels",
    "query": [],
    "body": false
  },
  "getMe": {
    "method": "GET",
    "path": "/me",
    "query": [],
    "body": false
  },
  "updateMe": {
    "method": "PATCH",
    "path": "/me",
    "query": [],
    "body": true
  },
  "changePassword": {
    "method": "POST",
    "path": "/me/password",
    "query": [],
    "body": true
  },
  "listUsers": {
    "method": "GET",
    "path": "/admin/users",
    "query": [
      "q",
      "role",
      "cursor",
      "limit"
    ],
    "body": false
  },
  "createUser": {
    "method": "POST",
    "path": "/admin/users",
    "query": [],
    "body": true
  },
  "updateUser": {
    "method": "PATCH",
    "path": "/admin/users/{userId}",
    "query": [],
    "body": true
  },
  "createHostel": {
    "method": "POST",
    "path": "/admin/hostels",
    "query": [],
    "body": true
  },
  "updateHostel": {
    "method": "PATCH",
    "path": "/admin/hostels/{hostelId}",
    "query": [],
    "body": true
  },
  "lookupParcel": {
    "method": "GET",
    "path": "/parcels/lookup",
    "query": [
      "code"
    ],
    "body": false
  },
  "listParcels": {
    "method": "GET",
    "path": "/parcels",
    "query": [
      "q",
      "status",
      "unmatched",
      "cursor",
      "limit"
    ],
    "body": false
  },
  "intakeParcel": {
    "method": "POST",
    "path": "/parcels",
    "query": [],
    "body": true
  },
  "getParcel": {
    "method": "GET",
    "path": "/parcels/{parcelId}",
    "query": [],
    "body": false
  },
  "assignParcel": {
    "method": "POST",
    "path": "/parcels/{parcelId}/assign",
    "query": [],
    "body": true
  },
  "searchMembers": {
    "method": "GET",
    "path": "/members",
    "query": [
      "q"
    ],
    "body": false
  },
  "listMyParcels": {
    "method": "GET",
    "path": "/me/parcels",
    "query": [
      "view"
    ],
    "body": false
  },
  "listMyRequests": {
    "method": "GET",
    "path": "/me/requests",
    "query": [],
    "body": false
  },
  "createRequest": {
    "method": "POST",
    "path": "/me/requests",
    "query": [],
    "body": true
  },
  "updateRequest": {
    "method": "PATCH",
    "path": "/me/requests/{requestId}",
    "query": [],
    "body": true
  },
  "cancelRequest": {
    "method": "DELETE",
    "path": "/me/requests/{requestId}",
    "query": [],
    "body": false
  },
  "collectNow": {
    "method": "POST",
    "path": "/me/collection",
    "query": [],
    "body": false
  },
  "cancelCollection": {
    "method": "DELETE",
    "path": "/me/collection",
    "query": [],
    "body": false
  },
  "registerDevice": {
    "method": "PUT",
    "path": "/me/devices",
    "query": [],
    "body": true
  },
  "listNotifications": {
    "method": "GET",
    "path": "/me/notifications",
    "query": [],
    "body": false
  },
  "markNotificationsRead": {
    "method": "POST",
    "path": "/me/notifications/read",
    "query": [],
    "body": false
  },
  "listCollections": {
    "method": "GET",
    "path": "/collections",
    "query": [],
    "body": false
  },
  "verifyCollection": {
    "method": "POST",
    "path": "/collections/{collectionId}/verify",
    "query": [],
    "body": true
  },
  "completeCollection": {
    "method": "POST",
    "path": "/collections/{collectionId}/complete",
    "query": [],
    "body": true
  },
  "getStats": {
    "method": "GET",
    "path": "/admin/stats",
    "query": [
      "dayStart"
    ],
    "body": false
  },
  "listAging": {
    "method": "GET",
    "path": "/admin/parcels/aging",
    "query": [
      "olderThanDays"
    ],
    "body": false
  },
  "remindParcel": {
    "method": "POST",
    "path": "/admin/parcels/{parcelId}/remind",
    "query": [],
    "body": false
  },
  "returnParcel": {
    "method": "POST",
    "path": "/admin/parcels/{parcelId}/return",
    "query": [],
    "body": false
  }
} as const;
