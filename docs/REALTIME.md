# Live updates

The app opens one WebSocket per signed-in session while it is in the foreground. The URL is the API base URL
with `/realtime` appended, using `ws` for local HTTP and `wss` for HTTPS. The channel and frame schemas are defined
under `x-realtime` and `components.schemas.Realtime*` in `contracts/openapi.yaml`.

The first frame is `{ "type": "authenticate", "token": "<session bearer>" }`. The server validates the ordinary
session and replies `{ "type": "ready" }`. Tokens are never placed in query strings, persisted in the event
stream or logged. Browser origins must match `CORS_ORIGINS`; native clients can omit Origin. An unauthenticated
connection has five seconds to authenticate, frames are limited to 2 KiB, and connection counts are bounded.
There are no user-selected subscriptions and the socket accepts no business writes.

After a successful HTTP operation commits, affected members and staff receive `{ "type": "changed" }`. Frames
contain no parcel IDs, contacts, recipient details or OTPs. Members do not receive other members' ordinary
parcel events. Shared hostel changes and the background worker's reconciliation refresh can notify all signed-in
clients. Each screen retrieves its current data through the existing role/ownership-checked HTTP endpoints.
Rejected validation/authorization requests emit no change event. An incorrect collection OTP is an exception:
it spends an attempt and can cancel the code, so its committed state change notifies the member and staff.
A failed push cannot turn a committed write into a failed HTTP result.

Every 20 seconds the server rechecks the sessions and sends `{ "type": "ping" }`; clients reply with
`{ "type": "pong" }`. Revoked, expired, deactivated or role-changed sessions are closed with code 4001. Invalid
protocol frames close with 1008; overloaded or slow connections close with 1013. The client signs out after 4001,
otherwise reconnects with exponential backoff and jitter. A silent connection is abandoned after 45 seconds.

Every ready frame triggers fresh reads, including after a reconnect, so events missed during a network outage
or server restart need no replay log. Leaving the foreground closes the socket; returning reconnects. Local
writes also invalidate local data immediately. Healthy connections do not poll each second. A 15-second fallback
checks focused screens while disconnected, and retries reads that failed even if the socket remains connected.
Unsaved form fields remain independent of refreshed resource data.

The signed-in account snapshot is refreshed through the same lifecycle. Profile forms accept remote changes
for untouched fields while preserving unsaved local edits. The member's code sheet checks the private
`GET /me/collection` metadata (identity, state and expiry only) to dismiss a replaced, cancelled or consumed
code. The OTP is never replayed by that read. An open guard sheet follows the current giveaway snapshot and
disables its actions if the code disappears or expires.

The hub is in memory in the existing single API process. Direct database changes and writes from a different
API process do not reach it. Add shared pub/sub (or a transactional event outbox and dispatcher) before scaling
to several API instances. Background expiry/reminder/retention jobs notify the local hub after their run. No
database migration is required for this channel.

## Checks before sign-off

Automated checks cover authorization, malformed messages, recipient isolation, session expiry/revocation,
failed-write isolation, reconnect/backoff, foreground cleanup, no one-second polling on a healthy socket, and
the browser arrival/collection workflow across an API restart. All database tests use the isolated local
`smart_mailroom_test` database.

On a physical phone, leave member Home open while the operator receives a parcel from another client; it
should appear without refreshing. Complete its collection and confirm Home/Past update. Repeat after putting
the phone in the background, switching Wi-Fi off/on and restarting the API. Use the printable barcode labels
to check actual camera scanning. These hardware checks remain separate from browser automation.
