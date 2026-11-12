# Notification realtime

Run one notification-service instance. The Socket.IO namespace is `/notifications`,
the Engine.IO path is `/socket.io`, and only the `websocket` transport is enabled.
REST stays behind the trusted Gateway; websocket authentication verifies the access
token directly using Keycloak JWKS and never trusts gateway headers or a client user ID.

Required configuration when `NOTIFICATION_REALTIME_ENABLED=true`:

- `KEYCLOAK_ISSUER_URL`: exact realm issuer, e.g. `https://identity.example/realms/homespace`.
- `KEYCLOAK_AUDIENCE`: audience configured in Keycloak access tokens for this service.
- `NOTIFICATION_REALTIME_ORIGINS`: comma-separated exact browser origins, e.g. `https://app.example,http://localhost:3000`. No wildcard, paths, or trailing slash.

Disabled by default; disabled connections fail closed. Enabled clients must send a
Keycloak RS256 access token (`typ=Bearer`) with `sub`, `iat`, `exp`, the expected
issuer and audience. ID tokens are rejected. TLS is required outside local development.
No token, recipient ID, or notification content is logged by realtime authentication.

## CLI smoke check

In a temporary directory outside the repository, install `socket.io-client@4`.
Save the following as `check.cjs`, set `NOTIFICATION_URL` (e.g.
`http://localhost:8085`), `APP_ORIGIN` to an allowed origin and `ACCESS_TOKEN` to a
short-lived access token in the shell environment, then run `node check.cjs`.
Do not paste tokens into shell history, URLs, screenshots, or committed files.

```js
const { io } = require('socket.io-client');
const socket = io(`${process.env.NOTIFICATION_URL}/notifications`, {
  transports: ['websocket'],
  auth: { token: process.env.ACCESS_TOKEN },
  extraHeaders: { Origin: process.env.APP_ORIGIN },
});
socket.on('connect', () => console.log('connected'));
socket.on('connect_error', (error) => console.log(error.message));
socket.on('disconnect', (reason) => console.log('disconnected', reason));
for (const event of [
  'notification:new',
  'notification:read',
  'notification:deleted',
  'notification:unread-count',
]) {
  socket.on(event, (payload) => console.log(event, payload));
}
```

1. Open two clients with account A's token and one with account B's token.
2. Deliver a persisted notification for A through the configured event ingestion
   boundary. Both A clients receive `notification:new`; B receives nothing.
3. Read/delete through authenticated Gateway REST. Both A tabs receive matching
   events and unread counts. Cross-user IDs return 404 and emit nothing.
4. `notification:read` carries a notification view, or `{ all: true }` after read-all;
   `notification:deleted` carries `{ id }`; unread-count carries `{ count }`.
5. Disconnect A, deliver another notification, reconnect A with a fresh token,
   and refetch REST `/feed` and `/unread-count`. There is no websocket replay.
   Refetch on every reconnect and after read-all; REST is the source of truth.
6. Missing/expired/tampered tokens, wrong issuer/audience, missing/unlisted
   Origin, and a handshake containing only `userId` must fail connection.
   A connection is disconnected at token expiration; reconnect with a fresh token.

Browser clients use `auth: { token }`; browsers supply Origin themselves. Tokens
are never accepted through query strings. There are no client room-join messages
or websocket mutation APIs. Unknown client messages cannot change stored data.

## Focused automated checks

```sh
npm test -- --runInBand src/modules/notification-realtime src/modules/notification/presentation/notification.controller.spec.ts
```

Auth tests generate RSA keys and serve a local JWKS endpoint. Gateway checks cover
JWT-derived room membership, multiple tabs, reconnects, unauthenticated attempts,
and recipient-scoped emission. HTTP checks cover owner-scoped mutations and events.

Rooms and delivery are process-local. Do not scale replicas until a shared Socket.IO
adapter is configured and tested. Delivery is best effort: disconnected clients,
process restarts, and concurrent mutations can miss or reorder realtime signals;
the persisted REST feed and unread count repair state on reconnect. Keycloak logout
or revocation does not close an already verified socket before its token expires.
