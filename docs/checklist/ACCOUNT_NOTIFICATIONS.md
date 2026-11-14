# Phase 1 — Account notifications

Status: accepted by Codex 2026-11-14 using focused unit/integration evidence. Risk L3: identity, authorization, Keycloak consistency, transaction and Kafka contract. Live Keycloak/browser/FCM not exercised.

- [x] Trace admin role/status callers, class-level transaction and synchronous Keycloak update; role assignments are local Core data, identities are Keycloak sub.
- [x] Freeze event types, recipients, payload allowlist, no-op and disabled-account semantics.
- [x] Implement durable producer in hs-user-service, without dependency on listing/payment; row lock serializes admin writes.
- [x] Extend strict consumer and safe own-account paths; keep push generic.
- [x] Integrate client subtype labels/display without profile fetch, forced logout, new auth behavior or title signals.
- [x] Codex tests successful/denied/no-op/failure/replay and actual Java -> Node contract compatibility.
- [x] Inspect final changes; record actual verification, DDL/rollout and remaining risks.

Evidence below is actual execution, not a plan or worker assertion. Claude wrote business code; Codex wrote and ran new acceptance tests. No commit/push/deployment.

## Frozen matrix

| Successful committed change | Event | Recipient |
|---|---|---|
| Admin assigns a different active role | ACCOUNT_ROLE_CHANGED | Persisted target user id |
| Admin changes active to false | ACCOUNT_DISABLED | Persisted target user id |
| Admin changes inactive to true | ACCOUNT_ENABLED | Persisted target user id |

Existing Kafka v1 exact envelope, one recipient, `data: {}`, metadata omitted/null, NORMAL priority, ACCOUNT category, fixed `/settings/account-security`. Unique eventId per transition; retries preserve payload/id. No notification for same value, denied, failed Keycloak call, transaction rollback, own profile changes, bootstrap or Keycloak sync echo. Preserve existing auth constraints and Keycloak reconciliation behavior; serialize admin target updates to avoid concurrent identical notices.

Disabled accounts may not be able to read the notice until re-enabled and logged in. Push remains generic and best-effort. No forced logout/profile fetch added. Existing non-atomic Keycloak/DB completion window remains explicit; this phase guarantees outbox atomicity with Core database state, not distributed transactions with Keycloak.

## Verification

| Boundary | Actual result |
|---|---|
| Core unit | 13/13, 0 skipped: AccountNotificationWriterTest 3, AccountNotificationServiceTest 9, existing UserServiceImplTest 1. Success/no-op/denied/Keycloak failure, order after synchronous Keycloak call, unique transition IDs, exact empty-data v1 payload. |
| PostgreSQL | 8 distinct scenarios passed across focused runs: first run 6 passed, 2 errors due to root test stubbing a transactional spy outside MANDATORY tx; fixed test to stub ultimate target, reran those 2: 2/2 passed. No production fix or weakened transaction checks. State/outbox rollback, Keycloak failure, concurrent same-status writes, per-user FIFO/retry, ACK-then-DB-failure replay and SKIP LOCKED verified. |
| Consumer | Account spec 38/38; existing booking/listing/rental and push privacy specs 138/138. Source build passed; scoped oxlint clean. |
| Java -> Node | 3 actual Java writer fixtures accepted by compiled Node parser/renderer, ACCOUNT category, empty data, fixed own-account link and omitted metadata. |
| Real Kafka -> Mongo -> REST | test:backend passed with 3 account types, duplicate replay, category query, fixed route, metadata null and denied cross-user read/delete. Existing booking/listing/rental smoke remained green. Only homespace_notification_test and random homespace.notification.test.* topics, no live push/socket. |
| Web | 3 new account assertions plus 1 existing stale-account link test passed; subtype fallback blocks prototype names, existing path, preferences opt-out, actual popup rendered with account tag and without rental invalidation. Scoped lint source/tests and npx tsc --noEmit passed. |

Commands from respective repo (PowerShell quote whole -D arguments):

```text
.\mvnw.cmd -o -pl hs-user-service -am "-Dtest=AccountNotificationWriterTest,AccountNotificationServiceTest,UserServiceImplTest" "-Dsurefire.failIfNoSpecifiedTests=false" test
.\mvnw.cmd -o -pl hs-user-service -am "-Dtest=AccountNotificationPostgresTest" "-Dsurefire.failIfNoSpecifiedTests=false" test
.\mvnw.cmd -o -pl hs-user-service -am "-Dtest=AccountNotificationPostgresTest#failureAfterOutboxInsertRollsBackLocalStateAndNotice+concurrentIdenticalAdminChangesCreateExactlyOneNotice" "-Dsurefire.failIfNoSpecifiedTests=false" test
npm test -- --runInBand src/modules/notification-events/account-notification.spec.ts
npm test -- --runInBand src/modules/notification-events/notification-events.spec.ts src/modules/notification-events/listing-notification.spec.ts src/modules/notification-events/rental-request-notification.spec.ts src/modules/notification-delivery/firebase-push.provider.spec.ts
npm run build
npm run test:backend
node --test --test-name-pattern=account tests/account-notification.test.mjs tests/rental-request-notification.test.mjs
```

PostgreSQL uses only NEW disposable database `core_notification_rollout_test_33add50a2fa8`, on existing hs-postgres. Exact URL asserted before every create-drop run; class regex restricts test prefix. Runtime credentials never printed or placed in repo. Test-only Boot JPA starter added to user module for these integration tests; no production dependency added.

## Additive schema and rollout

```sql
CREATE TABLE IF NOT EXISTS account_notification_outbox (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_id VARCHAR(36) NOT NULL UNIQUE,
  user_id VARCHAR(255) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_account_outbox_pending ON account_notification_outbox(sent_at,id);
CREATE INDEX IF NOT EXISTS idx_account_outbox_user ON account_notification_outbox(user_id,id);
```

Dev ddl-auto=update creates entity table; managed deployments apply equivalent schema first. Existing notification.* config/topic reused, no new env key. Rollout consumer -> web -> Core, since old consumers quarantine unknown types and commit offset. No auto purge of outbox; at-least-once with dedup, not exactly-once.

Limits: no notification on bootstrap, Keycloak console direct changes/sync echo, permission-definition changes or self-service CRUD. Lock held during synchronous Keycloak call; preserves serial admin decisions, but prolonged remote delays hold that account row. Remote Keycloak change cannot be undone if subsequent JPA commit fails; no new distributed consistency promise. No auth changes, provider calls or browser/disabled-session E2E verification.
