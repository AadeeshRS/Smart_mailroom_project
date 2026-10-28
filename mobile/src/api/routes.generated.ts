// Generated from contracts/openapi.yaml. Do not edit.
export const routes = {
  "login": {
    "method": "POST",
    "path": "/demo/sessions",
    "query": [],
    "body": true
  },
  "getSession": {
    "method": "GET",
    "path": "/session",
    "query": [],
    "body": false
  },
  "logout": {
    "method": "DELETE",
    "path": "/session",
    "query": [],
    "body": false
  },
  "getGuide": {
    "method": "GET",
    "path": "/guides/{platform}",
    "query": [],
    "body": false
  },
  "listOrders": {
    "method": "GET",
    "path": "/orders",
    "query": [
      "cursor",
      "limit",
      "q",
      "status"
    ],
    "body": false
  },
  "createOrder": {
    "method": "POST",
    "path": "/orders",
    "query": [],
    "body": true
  },
  "getOrder": {
    "method": "GET",
    "path": "/orders/{orderId}",
    "query": [],
    "body": false
  },
  "addTracking": {
    "method": "POST",
    "path": "/orders/{orderId}/tracking",
    "query": [],
    "body": true
  },
  "cancelOrder": {
    "method": "POST",
    "path": "/orders/{orderId}/cancellation",
    "query": [],
    "body": false
  },
  "listParcels": {
    "method": "GET",
    "path": "/parcels",
    "query": [
      "cursor",
      "limit",
      "q",
      "status",
      "hold"
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
  "getReview": {
    "method": "GET",
    "path": "/parcels/{parcelId}/review",
    "query": [
      "q",
      "limit",
      "cursor"
    ],
    "body": false
  },
  "reconcileParcel": {
    "method": "POST",
    "path": "/parcels/{parcelId}/reconciliation",
    "query": [],
    "body": true
  },
  "setHold": {
    "method": "POST",
    "path": "/parcels/{parcelId}/hold",
    "query": [],
    "body": true
  },
  "issueCredential": {
    "method": "POST",
    "path": "/parcels/{parcelId}/credentials",
    "query": [],
    "body": true
  },
  "verifyCredential": {
    "method": "POST",
    "path": "/parcels/{parcelId}/verifications",
    "query": [],
    "body": true
  },
  "confirmHandover": {
    "method": "POST",
    "path": "/parcels/{parcelId}/handover",
    "query": [],
    "body": true
  },
  "listNotifications": {
    "method": "GET",
    "path": "/notifications",
    "query": [
      "cursor",
      "limit",
      "q"
    ],
    "body": false
  },
  "readNotification": {
    "method": "POST",
    "path": "/notifications/{notificationId}/read",
    "query": [],
    "body": false
  },
  "listReceipts": {
    "method": "GET",
    "path": "/receipts",
    "query": [
      "cursor",
      "limit",
      "q"
    ],
    "body": false
  },
  "getReceipt": {
    "method": "GET",
    "path": "/receipts/{receiptId}",
    "query": [],
    "body": false
  },
  "resetDemo": {
    "method": "POST",
    "path": "/demo/reset",
    "query": [],
    "body": false
  },
  "getStaffParcel": {
    "method": "GET",
    "path": "/staff/parcels/{parcelId}",
    "query": [],
    "body": false
  },
  "getStaffReceipt": {
    "method": "GET",
    "path": "/staff/receipts/{receiptId}",
    "query": [],
    "body": false
  }
} as const;
