# Phase 3 — Payment and refund notifications

Status: ACCEPTED locally by Codex, 2026-11-14. Risk L3: monetary state, payer/payee identity, transaction, concurrency and Kafka contract. No commit, deployment or live provider call.

- [x] Complete main payment lifecycle and dispute/refund boundary audits.
- [x] Freeze event/recipient matrix and explicit ownership of future monthly/contract events.
- [x] Implement same-transaction durable payment notifications without duplicate rental/membership notices.
- [x] Extend strict consumer without changing legacy PAYMENT_* routes/schema.
- [x] Implement authorized paymentId landing and silent realtime updates without losing dispute form input.
- [x] Codex unit/integration, failure/denied/no-op/replay/concurrency tests.
- [x] Record actual verification, rollout/DDL/limits and accept before Phase4.

## Confirmed facts and unresolved decisions

- Persisted payerId/payeeId own payment reads; never infer recipient from TENANT/LANDLORD labels alone, because refunds reverse direction.
- Reported transfer is not confirmed receipt. A zero-amount onboarding exemption is not a bank transfer and must not produce payment-success text.
- `/dashboard/payments` already lists all payer/payee payments, all statuses, with no pagination; it currently ignores paymentId query. Proposed fixed landing `/dashboard/payments?paymentId=<id>` can highlight from that authorized list, avoiding a by-id endpoint that synchronizes monthly billing on read.
- Existing consumer PAYMENT_SUCCESSFUL/FAILED/OVERDUE uses paymentId and `/notifications`. New routed types must be distinguished by event name, not only idKey; preserve old contracts.
- Initial payment creation is not always concurrent with rental acceptance: `createFirstRent` may run later from onboarding scheduler. Do not blanket-exclude INITIAL creation without checking the call site and payable window.
- Membership notifications are done. Complaint workflows are excluded; payment-dispute actions are still in scope for audit. Monthly invoice decisions and contract lifecycle/settlement belong to later phases, but common payment receipt/report notifications may cross those callers; root must state the boundary precisely.

## Frozen Phase 3 contract

All new types use the unchanged v1 envelope, exactly `data: {paymentId}`, PAYMENT / NORMAL, one persisted party per envelope, metadata `{paymentId}` and fixed landing `/dashboard/payments?paymentId=<encoded id>`. No financial amounts, bank details, reasons, files, other-party identity or recipient role enter Kafka. Legacy PAYMENT_SUCCESSFUL/FAILED/OVERDUE and membership routes remain unchanged. Generic push stays unchanged. Deployment order: consumer, web, then Core.

| New type | Actual trigger | Recipient |
|---|---|---|
| PAYMENT_REQUEST_CREATED | Positive delayed first-rent INITIAL row actually inserted by createFirstRent; waiver/replay silent | Stored payer, including scheduler or lazy-read creation |
| PAYMENT_TRANSFER_REPORTED | Valid reportTransfer or mobile upload changes payment to TRANSFER_REPORTED | Stored payee |
| PAYMENT_RECEIPT_CONFIRMED | Valid payee confirmation changes payment to CONFIRMED | Stored payer |
| PAYMENT_RECEIPT_REJECTED | Valid payee rejection changes payment to REJECTED | Stored payer |
| PAYMENT_DISPUTE_OPENED | Valid party dispute changes payment to DISPUTED | Other stored party |
| PAYMENT_DISPUTE_EVIDENCE_ADDED | COMMENT attaches a genuinely new evidence object | Other stored party |
| PAYMENT_DISPUTE_PROPOSED | Valid new route proposal | Other stored party |
| PAYMENT_DISPUTE_PROPOSAL_DECLINED | Valid decline clears proposal | Proposer (other party) |
| PAYMENT_DISPUTE_ESCALATED | Valid escalation changes case state | Other stored party |
| PAYMENT_DISPUTE_REVIEW_TRANSFER | Accepted/admin-decided route returns payment to review; does not confirm money | Other party; admin decision reaches both |
| PAYMENT_DISPUTE_REOPENED | Accepted/admin-decided route reopens transfer | Other party; admin decision reaches both |

Payment direction always follows persisted payer/payee; refunds reverse the usual landlord/tenant direction. One new payment outbox table, aggregate paymentId FIFO, MANDATORY writer, persisted UUID replay and Kafka ACK semantics follow existing outboxes. Denied/no-op/rollback paths are silent. Add a refresh after mobile payment row lock so a stale managed instance cannot bypass the replay check.

Explicit boundaries:
- Initial/reservation creation during rental acceptance, hold expiry/cancellation and combined cancellation-refund creation already have rental notices; no extra creation event. Legacy adopt, admin claim and plain dispute notes/reused evidence remain silent.
- On onboarding REOPEN where RENTAL_HOLD_EXTENDED actually fires to the same recipients, suppress PAYMENT_DISPUTE_REOPENED only in that branch.
- All successful receipt confirmations (including refunds) notify the payer. A rental cancellation event is a separate lifecycle result; do not suppress every refund confirmation by key/type, since cancellation can still be pending on other refund rows or not run at all. No additional rental event is introduced.
- Monthly invoice creation, due-date changes, overdue/late-fee/rollover belong to Phase 4. Settlement/adjustment/agreed-refund creation and their deadlines belong to Phase 6 with their creating contract decision. These must be revisited in those phase matrices; common transfer/report/confirm/reject/dispute actions on every PaymentType are implemented now.
- No new scheduler or provider call. No automatic success from TRANSFER_REPORTED, dispute routing, zero-amount waiver or client notification content.
- Web landing uses authorized full `/mine` results, not the by-id endpoint with monthly sync side effects. Preserve in-progress dispute inputs during background refresh; guard account/query/unmount races and coalesce realtime/reconnect/focus recovery.

## Implementation and acceptance evidence

Affected repositories: `hs-core-api` (payment module plus existing dependent test fixture wiring), `hs-notification-service`, `hs-web-app`. Previous Phase1/2 changes are preserved. Claude implemented production source; Codex reviewed the triggers/callers, wrote new tests, ran verification and accepted the phase.

- Core: new `com.hs.payment.notification.PaymentNotification{Outbox,OutboxRepository,Writer,Publisher}`; hooks in PaymentRequestService, PaymentProofUploadSessionService, PaymentDisputeService. Required writer injection; existing constructor and Spring slice fixtures updated. Same-transaction event/case/receipt/ledger failures roll back notifications.
- Real PostgreSQL regression exposed an additional mobile race: `findByIdForUpdate` can throw on an already-managed stale version BEFORE a subsequent refresh. Final fix uses normal `findById` followed by mandatory `EntityManager.refresh(payment, PESSIMISTIC_WRITE)` before replay/status/evidence handling. A barrier-controlled test preloads the old row in both transactions; two valid sessions produce one upload, one evidence, one outbox event, both sessions consumed.
- Web: fixed common payment landing, auth gate/full login return, account-only key, selection from authorized `/mine`, stable card keys/drafts, one in-flight GET with coalesced dirty follow-up (even if old GET fails), hidden-tab recovery. Expanded dispute panels silently refresh for same-status case changes. Action links derive landlord/tenant from stored direction and parties: rental request detail by side, monthly invoices, other contract detail; they no longer always send owners to tenant requests or all settlements to invoices. No new inline money action was added.
- Consumer: separate exact-event-name map for 11 new types, strict singleton and paymentId-only branch, existing categories, generic push unchanged. Legacy/payment/order/account contracts tested together.

Verification actually executed (cumulative focused runs; successful unchanged cases were not repeatedly rerun):
- Core 110 distinct unit cases: PaymentNotificationWriterTest 3; PaymentRequestServiceTest 45; PaymentDisputeServiceTest 41; PaymentProofUploadSessionServiceTest 14; OnboardingPaymentCreationTest 5; MonthlyPaymentExtensionTest 2. All affected final cases passed.
- Core 11 PostgreSQL cases: actual confirmation/replay, denied/invalid action silence, transactional outbox failure rollback, stale parallel confirmations, reversed refund recipient, mandatory transaction, Kafka FIFO/failure/replay after ACK-before-DB-failure, actual report/reject/dispute routing, dispute proposal revision/audit rollback, parallel mobile uploads. All final cases passed. Only dedicated disposable `core_notification_rollout_test_33add50a2fa8` used; no business DB touched.
- Maven wrapper offline, targeted tests with `-pl hs-api-service -am`: final 15-case mobile-fix run BUILD SUCCESS and affected downstream production/test compilation through API assembly. Other accepted focused cases recorded in TEMP logs; no full test-suite claim.
- Notification Jest: new payment spec 61 + membership32 + account38 + Firebase privacy2 = 133 passing; legacy event/listing/rental specs136 passing. Nest build and scoped oxlint passed. All 11 actual Java outbox fixtures parsed/rendered by compiled Node consumer.
- Real existing Kafka → test Mongo → REST smoke passed for all11 new types with replay, routes, ownership denial and preferences; prior families also passed. Push/socket disabled in smoke. Test topics/database retained, never purged. Existing TimeoutNegativeWarning occurred but smoke exited0.
- Web 9 focused payment component tests + 3 affected transport tests passed; scoped ESLint and `tsc --noEmit` passed after final source changes. Includes auth/key/query, terminal refund landing, navigation by side, coalescing, hidden and rejected-request recovery, stable cards, reason/file preservation and same-status dispute revision updates, no unread-title feedback.
- Final diff whitespace checks passed in all three repositories (only existing line-ending conversion warnings).

Failure history is retained in temp logs: initial refund fixture referenced a nonexistent rental (corrected to standalone refund); new mocked billing clock lacked `now` (fixed fixture); mobile concurrent version conflict was a real production-source bug, fixed by Claude and retested. No failure was bypassed or reported as passed before its affected rerun succeeded.

## Rollout and limits

Consumer → web → Core, every consumer replica upgraded first. New Core table is required; local JPA `update` can create it. Environments using validation/manual migrations need this equivalent DDL BEFORE producer startup (not executed by this task):

```sql
CREATE TABLE payment_notification_outbox (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_id VARCHAR(36) NOT NULL UNIQUE,
  payment_id VARCHAR(36) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ
);
CREATE INDEX idx_payment_outbox_pending ON payment_notification_outbox(sent_at,id);
CREATE INDEX idx_payment_outbox_payment ON payment_notification_outbox(payment_id,id);
```

No real bank, chain, signature or Firebase call; browser visual/manual clicks were not exercised. Delivery remains at-least-once with consumer dedupe, push best effort and current single-replica socket architecture. Payment list is still an unpaged authorized full list and open panels retain their existing polling; pagination is not introduced here. Monthly invoice lifecycle and contract obligation creation/deadlines remain Phase4/6 work, not implemented by this acceptance.
