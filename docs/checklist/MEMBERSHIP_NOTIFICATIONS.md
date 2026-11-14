# Phase 2 — Membership notifications

Status: accepted by Codex 2026-11-14 after source review, focused unit/integration and cross-service verification. Risk L3: provider verification, monetary outcomes, concurrency, transaction and cross-service contract. No live SePay, chain RPC, wallet, Firebase or browser calls.

## Frozen scope/matrix

| Persisted result | Event | Recipient |
|---|---|---|
| Verified SePay IPN/ETH settlement changes order to PAID after successful membership activation | MEMBERSHIP_ACTIVATED | Persisted order.ownerId |
| Verified SePay IPN/ETH settlement changes order to REVIEW (including PAID -> REVIEW for second SePay transaction) | MEMBERSHIP_PAYMENT_REVIEW | Persisted order.ownerId |

Existing Kafka v1, one recipient, `data` exactly `{orderId}`; orderId is existing 32-hex membership order id (never ETH quote paymentId). PAYMENT/NORMAL, metadata exactly `{orderId}`, fixed `/dashboard/membership/return?orderId=<encoded>`. Immutable UUID per actual status transition; same retry preserves UUID/payload; orderId Kafka key and per-order FIFO outbox in payment module. No financial amounts, role, provider payload, hash, bank/wallet details, callback fields or reason in Kafka/push.

Review copy must be neutral: prior PAID may already have activated a plan before a second transaction requires review; never say the plan has never activated or promise refund/automatic resolution. No actor suppression on provider-confirmed outcomes, including ETH settle: durable verified outcome is useful even if the owner submitted the settlement request. Existing toast remains unchanged.

No event on same-status provider replay, failed/invalid verification, rollback, pending checkout, self cancellation, lazy old-order expiry or lazy membership expiry. No new scheduler/reminder/reconciliation process. REVIEW resolution is existing unfinished business workflow, not invented in this phase.

- [x] Audit source/callers, SePay and ETH, actual locks and status transitions.
- [x] Freeze event matrix, privacy, semantic distinction and authorized route.
- [x] Producer/outbox implemented and reviewed.
- [x] Strict consumer/templates added; old paymentId contracts unchanged.
- [x] Client badges and bounded silent order-status refresh implemented.
- [x] Codex tests provider verification/no-op/rollback/replay and actual Java/Node envelope.
- [x] Record verification, additive DDL, rollout and limits; accepted before Phase 3.

Phase1 changes are intentionally present in the same working trees; do not reset or recommit them. Claude wrote business source; Codex wrote and executed new acceptance tests.

## Acceptance evidence (2026-11-14)

- Consumer: 32 membership + 38 account cases passed; old booking/listing/rental 136 passed after the parser extension. Node build and scoped oxlint passed. Actual 2 Java-produced membership envelopes accepted/rendered by Node.
- Core final run: 28/28 passed, 0 skipped, BUILD SUCCESS: 19 unit scenarios (10 existing checkout, 2 ETH membership, 7 new acceptance) + nine real PostgreSQL scenarios. All affected tests rerun after the source fix.
- PostgreSQL confirmed a real bug before acceptance: parallel duplicate SePay callbacks produced two outbox rows because unlocked preview loaded a managed PENDING order before acquiring the owner lock. Claude added explicit refresh of locked orders (SePay/cancel) and locked order+quote (ETH), preserving lock order and provider validation. Final cases prove one notice for duplicate simultaneous SePay/ETH outcomes; cancel cannot overwrite committed verified outcome; plan/order/quote/outbox roll back together; MANDATORY writer, late REVIEW, retry FIFO and ACK-before-DB-failure replay work.
- Web: six focused tests passed after review fixes: auth-before-API, keyed account/order isolation, late outcome after 15 polls, shared GET/coalescing, hidden/debounce plus hidden-during-await recovery, stale response cleanup. Transport membership signal/title test and two old ETH calldata tests passed. Source lint and tsc passed. No live browser check.
- Real Kafka/Mongo/REST smoke passed with two membership outcomes plus replay/ownership/routes and existing domains. Test DB/topic only; FCM/socket disabled.

Root test-setup failures were diagnosed before retry: overlapping JPA repository package scan, missing ListingStatusHistoryRepository, and restubbing a previously throwing mock via when(). These were test defects, separate from the confirmed business concurrency bug. Do not treat the failed runs as overall green.

## Reproduction and rollout

Commands run from each repo, with exact disposable PostgreSQL URL asserted before the Maven integration run:

```text
.\mvnw.cmd -o -pl hs-payment-service -am "-Dtest=MembershipNotificationPostgresTest,MembershipNotificationAcceptanceTest,MembershipCheckoutServiceTest,EthMembershipPaymentServiceTest" "-Dsurefire.failIfNoSpecifiedTests=false" test
npm test -- --runInBand src/modules/notification-events/membership-notification.spec.ts src/modules/notification-events/account-notification.spec.ts
npm test -- --runInBand src/modules/notification-events/notification-events.spec.ts src/modules/notification-events/listing-notification.spec.ts src/modules/notification-events/rental-request-notification.spec.ts
npm run build
npm run test:backend
node --test tests/membership-notification.test.mjs
node --test --test-name-pattern="membership socket" tests/rental-request-notification.test.mjs
node --test tests/membership-eth-payment.test.cjs
npx tsc --noEmit
```

Only DB `core_notification_rollout_test_33add50a2fa8`, Mongo `homespace_notification_test` and random test Kafka topics used; credentials withheld. The new payment test dependency is Boot JPA starter with test scope, already used elsewhere; no production dependency introduced. No full-platform build or provider E2E.

```sql
CREATE TABLE IF NOT EXISTS membership_notification_outbox (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_id VARCHAR(36) NOT NULL UNIQUE,
  order_id VARCHAR(32) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_membership_outbox_pending ON membership_notification_outbox(sent_at,id);
CREATE INDEX IF NOT EXISTS idx_membership_outbox_order ON membership_notification_outbox(order_id,id);
```

Schema is additive; not applied to business DB here. Dev Hibernate update or equivalent managed migration before producer. Consumer -> web -> Core deployment order; old strict consumer quarantines unknown types and commits offsets. Existing notification.* configuration/topic reused; no new env key. At-least-once with consumer dedup, no exactly-once claim or retention/purge job.

Limits: no REVIEW resolution process, payment retry/reminder scheduler or automatic membership-expiry notices added. Web reads current authorized backend order status, never callback success parameters; changing account/order remounts state, no forced profile/token refresh. Real provider and browser display remain unverified. A provider-verified transfer can require REVIEW; no promise of refund or activation. No commits/push/deployment.
