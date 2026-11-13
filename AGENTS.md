# HomeSpace Notification Service — Agent Instructions

## Scope

NestJS microservice (Node >= 22.14) for the HomeSpace notification domain. It consumes Kafka notification events, stores notifications in MongoDB, serves a REST feed API through the Gateway, pushes realtime updates over Socket.IO, and sends Web Push through Firebase Admin.

This is an implemented service, not a skeleton. Read the relevant doc before changing a flow:
- `README.md` and `docs/SETUP_AND_TEST.md`: environment variables, REST API, local setup.
- `docs/KAFKA_TESTING.md`: Kafka event envelope v1, event types, durability, DLT recovery.
- `docs/NOTIFICATION_PROGRESS.md`: implemented behavior and known limits.
- `docs/PUSH_SETUP.md`, `docs/REALTIME_TESTING.md`, `docs/ADMIN_BROADCAST_TESTING.md`: push, realtime and admin broadcast.

Do not read all docs for a small change. Treat `docs/memory.md`, if present, as a local handoff note, not as a rule source.

## Architecture

- Respect NestJS module boundaries under `src/modules`: `authentication`, `notification` (feed, preferences, admin broadcast), `notification-events` (Kafka consumer), `notification-delivery` (devices, push jobs, Firebase), `notification-realtime` (Socket.IO), `health`.
- This service owns notification persistence (MongoDB `homespace_notification`). Do not access other services' databases. Reading other services is done through their APIs only (the admin broadcast reads the user directory API).
- Preserve existing REST, Kafka, Socket.IO and Firebase contracts: paths, response envelope (`ApiResponseDto`), event envelope, event names, socket events.
- Do not add a public HTTP endpoint that creates notifications. Web and mobile clients must not create trusted Kafka business events; producers are trusted backend services.
- Keep ports/adapters seams (repository interfaces, push provider) so unit tests do not need MongoDB, Kafka or Firebase.

## Authentication and Authorization

- REST identity comes from Gateway headers, trusted only with a valid `X-Internal-Secret` (`GatewayAuthenticationGuard`). Preserve that check; never add a default secret.
- Never trust a user identifier supplied by the client in a body, query or path. Use the verified identity for recipient scoping.
- Enforce notification ownership on every read, update and delete: a user can only access their own notifications.
- Preserve `AdminGuard` on admin broadcast. Do not widen it.
- Never expose Firebase service credentials, the Gateway secret or MongoDB URIs. Do not put them in logs, responses, fixtures or frontend code.

## Kafka

- Preserve strict envelope validation (v1: `eventId`, `eventType`, `version`, `occurredAt`, `recipients`, `data`; unknown properties rejected) and version compatibility. A new version must not break v1 consumers.
- Handle duplicate events idempotently: unique `(recipientId, sourceEventId)`.
- Preserve offset semantics: commit only after all recipients are persisted, or after an invalid message is acknowledged by the DLT. Never commit in a way that silently loses an event.
- Keep retry behavior bounded and keep the DLT payload redacted (source coordinates, reason code, payload hash only). Do not add message bodies, recipients or exception details to DLT records.
- Do not add topic auto-creation or change topic names without checking the producers and `hs-infra` configuration.

## MongoDB

- Preserve unique constraints, recipient isolation and unread/read/soft-delete semantics.
- Avoid destructive migrations. Index changes on existing collections need a rollout consideration.
- Do not introduce cross-service database access.

## Firebase Web Push

- Preserve device installation ownership: installation secret proof hash, protection against moving an installation to another account, multiple devices per user.
- Protect installation secrets; never log them.
- Handle invalid tokens and provider failures without losing the in-app notification. Push job states (`pending`, `processing`, `accepted`, `failed`, `skipped`), lease and retry behavior must stay consistent.
- Provider `accepted` is not "read" or "displayed". Do not conflate them.
- Push content stays generic. Do not add private notification content, chat text or financial details to push payloads.

## Socket.IO

- Preserve JWT/JWKS verification on handshake, the origin allowlist, room membership derived from the verified `sub`, and disconnect on token expiry.
- Preserve event payload compatibility (new, read, deleted, unread-count). A realtime failure must not fail an already persisted REST operation.
- Realtime currently supports a single replica. Do not claim multi-replica support without a shared adapter.

## Verification

Check `package.json` scripts first. Known scripts: `npm test` (Jest), `npm run lint` (oxlint), `npm run build`, `npm run test:e2e`, `npm run test:backend` (smoke test that needs real Kafka and MongoDB).

- Prefer focused Jest runs, for example `npm test -- --runInBand src/modules/notification-events`, and `npx tsc --noEmit --incremental false` for typechecking.
- Validate event contracts and authorization with unit tests; add a denied-case test for authorization changes.
- Do not make live Firebase calls by default. Do not start Kafka or MongoDB for ordinary unit tests.
- Run `test:backend`, Mongo integration tests or e2e only when the change scope requires integration, and only with a test database and test topics.
- Do not delete or reset topics, databases or test records.

Risk: Kafka offset/DLT handling, authorization, ownership, installation secrets and the event contract are L3. Local logic and DTO fixes are L2. Documentation is L1.

## Skills

- `notification-flow-review`: explicit, review-only check of the event → persistence → push/realtime flow. Do not run it automatically after normal changes.

## Completion

Report changed behavior, verification that actually ran, contract impact and unverified integration risks.
