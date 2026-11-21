# HomeSpace Notification Service — Agent Instructions

## Engineering standards

- Preserve business invariants, public contracts and backward compatibility. Keep authentication, authorization, input validation and error handling intact.
- Protect secrets and sensitive data in code, commits, tests, logs and reports. Treat third-party hooks as untrusted until reviewed and explicitly authorized.
- Change production configuration, deploy or run destructive data operations only when explicitly authorized for the target environment.
- Keep review tasks read-only unless the developer requests fixes.

## Execution policy

- **FAST** is the default for a small fix, one API, a simple UI or configuration change, or a limited refactor. Start as soon as the scope is clear. Use the fewest useful calls, with a soft ceiling of roughly 8–12 in normal conditions.
- **STANDARD** fits multi-file features, API contract changes, broader refactors and hard-to-reproduce bugs. Make a short plan, inspect affected dependencies and verify in one focused round after editing.
- **DEEP** is required for significant security, authentication, authorization, payment, deposit, transaction, contract lifecycle, migration, architecture or incident risk. Identify the relevant invariants and verify the affected boundaries, including failure and denied cases where applicable. Escalate by risk even for small changes.

### Work and tools

- Identify the goal and smallest correct scope. Read the directly affected files, then check callers or dependencies when the change can affect them. Plan mentally or in a few lines for complex work, then execute.
- Give each tool call a purpose that advances the request or reduces a real risk. Batch independent reads and search exact paths or symbols. Reuse results when inputs are unchanged. Skip full repo scans, subagents and independent review passes for routine tasks.
- For a small review, stop at the requested diff when it establishes the findings. Inspect callers, test setup or runtime behavior only if a material finding depends on evidence missing from that diff.
- **No repeated verification without new evidence.** Repeat a read, search or check only when relevant inputs changed, an error or conflicting evidence appeared, or a required risk check remains. If two investigation attempts yield no useful evidence, change approach or stop that investigation.
- Make routine technical decisions independently. Ask when essential information is missing or the action requires authorization. Reuse existing code and patterns, protect user changes, and keep edits and dependencies within scope.

### Git and validation

- Run `git status --short` at most once at the start if needed to identify existing edits, and once at the end if needed to report files. Inspect the scoped diff once when useful. Use `git diff --stat` only to summarize scope and `git diff --check` at most once at the end when applicable. Reuse existing evidence for the same Git state. Recheck affected state for new errors, conflicts or concrete risk. Commit, reset, clean, checkout or discard only when requested.
- Normally validate once after editing with the smallest relevant test or compiler check. Skip full builds for small changes. Expand checks when evidence or risk warrants it. On failure, distinguish code from environment causes, diagnose and rerun only the affected check after a relevant change. Reuse test output already returned. If a check is blocked, use a permitted alternative only when the evidence is necessary, or report the blocker.

### Stop and report

Stop when the request and acceptance criteria are met, required checks are complete and concrete in-scope issues are resolved. Skip speculative optimization, unrelated refactors and automatic chains of review, audit or verification. Report **Completed**, **Validation** and **Notes** when needed. List only checks actually run and state material limits or remaining risks.

## Scope

NestJS microservice (Node >= 22.14) for the HomeSpace notification domain. It consumes Kafka notification events, stores notifications in MongoDB, serves a REST feed API through the Gateway, pushes realtime updates over Socket.IO, and sends Web Push through Firebase Admin.

This is an implemented service, not a skeleton. Read the relevant doc before changing a flow:
- `README.md` and `docs/SETUP_AND_TEST.md`: environment variables, REST API, local setup.
- `docs/KAFKA_TESTING.md`: Kafka event envelope v1, event types, durability, DLT recovery.
- `docs/NOTIFICATION_PROGRESS.md`: implemented behavior and known limits.
- `docs/PUSH_SETUP.md`, `docs/REALTIME_TESTING.md`, `docs/ADMIN_BROADCAST_TESTING.md`: push, realtime and admin broadcast.

Read the docs relevant to the change. Treat handoff notes as historical context and verify their claims against the current code and project instructions.

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
- Preserve topic names and the existing provisioning model. Before proposing topic auto-creation or a rename, compare the local topic settings with the producer contract in `docs/KAFKA_TESTING.md` and flag any producer or provisioning checks that need coordination.

## MongoDB

- Product rule: CHAT delivery records are internal to popup/push delivery and deduplication. Exclude CHAT (including historical records) from bell feed, unread count and bell read-all. Keep chat's own unread state separate. Do not treat its absence from the bell as missing integration.

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

Use DEEP for Kafka offset/DLT handling, authorization, ownership, installation secrets and event contract changes. Local logic, DTO fixes and docs normally use FAST when these boundaries stay intact.

## Skills

- `notification-flow-review`: explicit, review-only check of the event → persistence → push/realtime flow. Do not run it automatically after normal changes.

## Completion

Report changed behavior, verification that actually ran, contract impact and unverified integration risks.
