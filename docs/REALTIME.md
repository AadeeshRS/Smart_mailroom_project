# Live updates

The app opens one WebSocket per signed-in session while it is in the foreground. The URL is the API base URL
with `/realtime` appended, using `ws` for local HTTP and `wss` for HTTPS. The channel and frame schemas are defined
under `x-realtime` and `components.schemas.Realtime*` in `contracts/openapi.yaml`; the server side is
`api/src/realtime.ts`, the client `mobile/src/realtime.ts` and `mobile/src/refresh.ts`.

## Connecting

- The first frame is `{ "type": "authenticate", "token": "<session bearer>" }`; the server checks the ordinary
  session and replies `{ "type": "ready" }`. Tokens never go in a URL (a query string gets 400), in an event or in
  a log.
- **No Origin check.** React Native on Android always sends `Origin: http[s]://<API host>`, and the token travels
  in the first frame rather than a cookie, so another site can't use a socket without it.
- The socket has **5 seconds to send its first frame**. The clock stops when that frame arrives, so a slow session
  lookup (a waking database, say) is never cut short. A socket that sends nothing is terminated; the client sees
  1006 and reconnects.
- Limits: frames up to 2 KiB, 5 sockets per user, **10 unauthenticated sockets per IP** (the 11th gets 429), 500
  in all (503).
- There are no subscriptions, and the socket accepts no business writes.

## What the server sends

Every frame is exactly `{ "type": … }`: `ready`, `changed` or `ping`. None carries a parcel ID, contact, name or
OTP; the app re-reads its open screens through the ordinary permission-checked HTTP endpoints.

`changed` follows a successful write, after the HTTP reply has been sent:

| Write | Who gets `changed` |
|---|---|
| Parcels, requests, collections, users, hostels | The members it affects (recipient, requester, the collection's member, the user changed) and every staff app. Hostel changes reach everyone (the hostel list) |
| Personal: logout, profile, password change, notifications, devices | Only the writer's other sessions |
| Public: sign-up, email verification and codes, login, password reset | Nobody |
| A wrong collection code (the call fails, but spends an attempt) | The member and staff, including the guard who typed it |

The session that made a successful write never gets its own `changed`: the app already refreshed after the reply.
The background worker publishes only when a job changed something someone can see (an expired request or code, a
reminder, a retention run), and only to those members and staff.

## Keeping sessions honest without polling the database

An idle socket causes **no database query**. Publishing and the 20-second `ping` work from memory.

- Each socket remembers its session's expiry. When that passes, the next heartbeat re-reads just that session
  (sessions slide forward once a day while used) and closes it with **4001** only if it has really ended.
- Logout, a password change or reset, a deactivation and a role change re-read just that user's sockets right away
  and close the ended ones with 4001.
- If such a re-read fails (database unreachable), that tick is skipped; nobody is disconnected for it.

## Close codes and the client

| Code | Meaning | The app |
|---|---|---|
| 4001 | The token was checked and rejected (signed out, expired, deactivated, role changed) | Signs out |
| 1006 | No first frame within 5 s, a missed ping, or the network/server went away | Reconnects |
| 1008 | A malformed, binary or out-of-order frame | Reconnects |
| 1011 | The database failed during the session lookup | Reconnects |
| 1013 | Too many sockets for this user, or a client too slow to read | Reconnects |

Reconnecting backs off 1, 2, 4 … 30 seconds with jitter. Every `ready` triggers fresh reads, so events missed
while disconnected need no replay log. A socket silent for 45 seconds is abandoned and reopened. Leaving the
foreground closes the socket; returning reconnects. While disconnected, open screens re-read every 15 seconds.

The client answers each `ping` with `{ "type": "pong" }`; a socket that misses one is dropped by the next
heartbeat (20 to 40 seconds).

## The app side

- Local writes refresh the open screens as soon as their reply arrives (`mobile/src/api/http.ts`).
- Profile forms take remote changes only for fields the user hasn't touched.
- The member's code sheet closes on its own countdown, and when `GET /me/collection` shows the code was replaced,
  cancelled or used (identity, state and expiry only; never the OTP).
- An open handover sheet follows the giveaway queue and disables its actions when the code disappears or expires.
- The operator's Parcels list is one live request; Load more grows it up to 100 rows.

## Deployment limits

The hub lives in the one API process. Writes on another instance, and direct database changes, don't reach it:
add shared pub/sub (or a transactional outbox and dispatcher) before running several instances. On Render's Free
plan an open app keeps the service awake (it counts WebSocket messages as traffic); see `docs/DEPLOYMENT.md`.

## Checks before sign-off

`api/tests/realtime.test.ts` covers authentication, bad frames, Origin, recipient isolation, who hears what, the
4001 cases, the 5-second deadline and a slow session lookup, idle cost (no table touched), the worker's
publishing and the per-IP limit. `mobile/tests/realtime.test.ts` covers reconnecting, backoff and signing out only
on 4001. The browser suites cover arrival, collection, code replacement and an API restart. All database tests use
the isolated local `smart_mailroom_test` database.

On a physical phone, leave member Home open while the operator receives a parcel from another phone; it should
appear within about a second. Repeat after putting the phone in the background, switching Wi-Fi off and on and
restarting the API, and scan the printable labels in `docs/test-labels` with the camera.
