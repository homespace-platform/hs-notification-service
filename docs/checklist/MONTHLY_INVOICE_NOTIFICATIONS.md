# Phase 4 — Monthly invoice notifications

**Current status (2026-11-14): ACCEPTED locally by Codex (root).** Codex reviewed the writer, publisher, hooks, the narrowed acknowledgement scope and the explicit-reject fee catch-up, and accepted Phase 4 together with the final web fix below. All three audits were received, the 13-type matrix is frozen, Core/consumer/web source and tests were run (evidence below). Acceptance is local only: no commit, push or deploy. Phase 5 (move-in) and Phase 6 (contract lifecycle) are NOT done. L3 (money, immutable issued invoices, schedules, identity, transactions, Kafka).

Dispatch history: the first Core dispatch was intentionally paused for code review (not a failure) and the user resumed it. Live workers: Core `ctx_a4227f169a2d` (task_720cc22eca69, sole Maven/`target`/PostgreSQL owner), consumer `ctx_98dd389163bb` (Java-fixture follow-up `ctx_5e8356b816d4`), web `ctx_38561ecddaab`.

- [x] Trace creation/prepare/issue/reconcile/scheduler and all invoice writes/callers (lifecycle audit received).
- [x] Trace extension requests/decisions/expiry, overdue decisions, deferral and termination boundaries (extension audit received).
- [x] Audit consumer/web authorized invoice landing, same-status updates and draft preservation (consumer/web audit received).
- [x] Freeze trigger → recipient → event/data → route and explicit Phase 6 handoff (below).
- [x] Core implementation (this file, "Core implementation"). Consumer and web implementations are owned by their workers (their evidence is quoted from their reports, not re-run by the Core owner).
- [x] Core tests written and run (unit + real PostgreSQL, "Verification actually run").
- [x] Root review and acceptance: Codex accepted Phase 4 locally after reading the source and evidence (this docs update records it; no code or test was run for it).

## Frozen Phase 4 contract

All 13 new types: category PAYMENT, priority NORMAL, unchanged v1 envelope, `data` exactly `{contractId, invoiceId}` (both actual persisted 36-char ids; consumer `identifier` rule), one recipient per envelope, metadata the same, fixed landing `/dashboard/invoices/<encoded contractId>?section=monthly&invoice=<encoded invoiceId>`. No role, dates, amounts, meter values, notes, reasons or names in Kafka/push. UUID per distinct outcome/recipient with persisted replay; aggregate/Kafka key = invoiceId. The tenant never receives a DRAFT invoice id. Synthetic first-rent rows (`first-rent:<paymentId>`) are silent. Legacy PAYMENT_*, membership, account and Phase 3 payment routes unchanged. Deploy consumer → web → Core (an old consumer sends unknown types to the DLT and commits).

| # | Type | Actual trigger | Recipient | Core hook (MonthlyBillingService unless noted) |
|---|---|---|---|---|
| 1 | INVOICE_DRAFT_READY | each actually inserted DRAFT (period close or catch-up) | locked contract landlord | `syncContract`, after `saveAndFlush` of the new draft (contract row locked) |
| 2 | INVOICE_ISSUED | actual positive manual/auto/catch-up issue; CLS final-cost supplement insert (zero total and idempotent supplement silent) | tenant | `issue(...)` UNPAID branch; `ContractLifecycleService.issueFinalCosts` after the new bill and payment exist |
| 3 | INVOICE_OVERDUE | actual UNPAID → OVERDUE (not while reported/disputed; repeat silent) | landlord + tenant (one row each); tenant row omitted when EXTENSION_EXPIRED already informed them in the same reconcile | `reconcile(invoice, announce)` transition branch |
| 4 | INVOICE_AMOUNT_UPDATED | only when `payments.increaseMonthlyPayment` returned true, and the tenant was not already informed by OVERDUE/EXTENSION_EXPIRED in that reconcile | tenant | `accrueLateFee` now returns the boolean; `reconcile` decides |
| 5 | INVOICE_EXTENSION_REQUESTED | actual pending tenant request | landlord | `requestPaymentExtension` |
| 6 | INVOICE_EXTENSION_APPROVED | actual approve or direct extend | tenant | `approveExtension` (shared by `decidePaymentExtension` and `extendPaymentDirectly`) |
| 7 | INVOICE_EXTENSION_REJECTED | explicit landlord reject; internal `rejectPendingForOtherDecision` silent | tenant | `decidePaymentExtension` reject branch, before the catch-up reconcile |
| 8 | INVOICE_EXTENSION_EXPIRED | actual PENDING → EXPIRED (paid CLOSED silent); not suppressed by HTTP actor (lazy reads are system effects) | tenant | `reconcile` pending-request branch |
| 9 | INVOICE_OVERDUE_ACTION_RECORDED | each appended landlord overdue action (server UUID per action, no new dedupe) | tenant | `recordOverdueAction` (not `terminationEvent`) |
| 10 | INVOICE_OVERDUE_ACTION_ACKNOWLEDGED | first tenant acknowledgement (replay throws, silent); viewing evidence, not consent | landlord | `acknowledgeOverdueAction`, only for the four landlord-recordable types (see Decisions) |
| 11 | INVOICE_DEFERRED | first manual deferral (repeat returns without write, silent); first automatic rollover decision | tenant (manual); landlord + tenant (automatic) | `deferToNextPeriod`; `autoDeferIdleInvoice` |
| 12 | INVOICE_ROLLED_OVER | actual old invoice → ROLLED_OVER with old payment cancelled, aggregate = OLD invoice | tenant | `issue(...)` carry-forward block (same transaction as the new invoice's ISSUED) |
| 13 | INVOICE_OVERDUE_ACTION_REQUIRED | first setting of existing `overdueActionLoggedAt`, only when not deferred and no active termination/extension/pending request | landlord | `processMilestones` (marker and log unchanged) |

Boundaries: no invoice PAID event (Phase 3 receipt confirmation notifies); no repeated transfer/receipt/dispute events; no new scheduler or advance reminder (payment and meter reminder flags stay log-only). Auto-issue time and missing-meter policy unchanged.

## Core implementation (hs-core-api, module hs-contract-service)

New package `com.hs.contract.notification`: `ContractNotificationOutbox` (table `contract_notification_outbox`: id identity, unique `event_id` varchar36, `aggregate_id` = invoiceId, topic, payload text, created_at, sent_at; indexes `(sent_at,id)` and `(aggregate_id,id)`), `ContractNotificationOutboxRepository`, `InvoiceNotificationWriter` (`enqueueLandlord/Tenant/Both`, each `@Transactional(MANDATORY)`; validates the invoice belongs to the locked contract and that the recipient is a stored party; UUID eventId per row; one envelope per recipient, a contract whose parties coincide yields one envelope) and `ContractNotificationPublisher` (FIFO unsent head per aggregate, `FOR UPDATE SKIP LOCKED`, Kafka send acknowledged before `sent_at` is written, existing `notification.*` properties, `notification.outbox.enabled` switch).

- `MonthlyBillingService` takes the writer as a required final constructor field (no optional/null workaround). `ContractLifecycleService` likewise.
- Suppressions are explicit private parameters, not shared state: `reconcile(invoice, announce)`, `processMilestones(..., announce)`, `autoDeferIdleInvoice(invoice, announceTenant)`. They are `false` ONLY for the invoice issued in the same automatic-issue transaction. No ThreadLocal or global flag.
- Lock order contract → invoice → payment, amount/snapshot immutability, authorization, hold checks and version checks are unchanged; every enqueue happens after the state writes in the existing transaction and takes no new lock.
- Constructor/fixture fallout updated: `MonthlyBillingServiceTest`, `UnilateralTerminationServiceTest`, `ContractLifecycleServiceTest`; PG fixtures `ContractLifecyclePhase03PostgresTest`, `RentalWorkflowPostgresTest`, `ComplaintCasePostgresTest`, `RentalWorkflowHttpSystemTest` now import the writer and repository (compile-checked only, see limits).
- DDL: one additive table created by JPA DDL like the earlier outbox tables (no SQL migration file exists for billing); confirm `ddl-auto`/DDL policy per environment before deploy. No enum, column or existing-table change.

### Decisions recorded where the matrix left room
1. **Catch-up issue + immediate automatic rollover:** inside the issuing transaction the new invoice's tenant gets ISSUED only (no OVERDUE, AMOUNT_UPDATED, ACTION_REQUIRED or DEFERRED for that invoice); the landlord still gets DEFERRED because the landlord was not told about the issue. Business mutation (`deferredAt`, `ROLLOVER`, AUTOMATIC_ROLLOVER action, accrued fee) is identical. Old-invoice decisions are not suppressed (the previous invoice's reconcile/auto-defer/ROLLED_OVER announce normally). The ordinary shared sync announces DEFERRED to both parties.
2. **Acknowledgement scope:** `acknowledgeOverdueAction` shares its list with system and termination entries. Only PAYMENT_REQUEST, EXTENSION_PROPOSAL, MUTUAL_TERMINATION_PROPOSAL and LEGAL_REVIEW (the types `recordOverdueAction` can append) notify the landlord; acknowledging a termination/system entry is silent (Phase 6). Root should confirm this narrowing.
3. **Explicit reject + fee catch-up:** the matrix suppresses AMOUNT_UPDATED only when OVERDUE/EXTENSION_EXPIRED informs the tenant in the same reconcile, so an explicit reject can be followed by AMOUNT_UPDATED if the catch-up fee really changed the QR amount.
4. **Nested review approve:** `decideTerminationReview` (approve) still calls `deferToNextPeriod`/`extendPaymentDirectly`, which emit their normal financial child outcome (DEFERRED or EXTENSION_APPROVED). Phase 6 must consolidate that with its future combined termination-review notice.
5. **First-rent / DRAFT:** first-rent rows are never written (read model only); `prepare` and any denial are silent; the tenant never receives a DRAFT id.

## Phase 6 handoff (explicitly NOT implemented here; no production query was made for legacy counts)

Reachable legacy rows must still be handled by Phase 6; do not assume there are no legacy proposals.
- `MonthlyBillingService`: `issueUnilateralTermination`, `requestTerminationReview`, `decideTerminationReview` (decision itself; the nested financial child is Phase 4), `withdrawUnilateralTermination`, `completeUnilateralHandover` (+ `finalizeTermination`: listing/parking release, deposit retention), `syncUnilateral` auto-end (`finishUnilateral`: contract TERMINATED, DRAFT → CANCELLED, `cancelPendingRenewalsForClosedParent`) and the `CANCELLED_PAID` withdrawal, `terminationEvent` audit entries, `BILLING_TERMINATION_CANCELLED_BY_PAYMENT` in `reconcile`.
- Legacy mutual termination in the same service: `proposeMutualTermination` (route disabled), `accept/decline/withdraw/complete/forceTerminationAfterDecline`, still reachable for rows with `terminationProposedAt` set before 2026-11-04.
- Outside the service: `ContractLifecycleService.syncLocked` (marks PAID, closes pending extension requests, cancels a legacy proposal), the closure messages around a supplement (`COSTS_ADDED`, deposit-proposal reset), `ContractAmendmentService` deleting DRAFT invoices past a new lease end, `MutualTerminationService` trimming the last DRAFT period.

## Verification actually run (Core owner; Maven serial, one owner; PostgreSQL only the disposable `core_notification_rollout_test_33add50a2fa8`, exact URI asserted before the run; no real provider, broker or business DB)

Logs under `C:/Users/nvmin/AppData/Local/Temp/`:
- `homespace-phase4-compile1.log`: `-pl hs-contract-service -am test-compile` OK. `homespace-phase4-api-compile.log`: `-pl hs-api-service -am test-compile` OK (downstream fixtures).
- `homespace-phase4-baseline.log`: first run of existing suites against the new hooks: ContractLifecycleServiceTest 37/37, UnilateralTerminationServiceTest 20/20, **MonthlyBillingServiceTest 4 errors** — mocked `saveAndFlush` returned null/id-less drafts (fixture, not production; a real JPA insert has an id). Fixed in the fixture (default stub assigns the id); production has no null guard.
- `homespace-phase4-billing1.log`: 2 further fixture problems found in my first new tests (stateful draft lookup, re-stubbing `saveAndFlush`), fixed. `homespace-phase4-billing2.log`: MonthlyBillingServiceTest **106/106, 0 skipped**.
- Review fix (catch-up tenant DEFERRED suppression): `homespace-phase4-billing3.log` MonthlyBillingServiceTest **106/106, 0 skipped**; `homespace-phase4-unit3.log` Unilateral **24/24**, ContractLifecycleServiceTest **37/37**, InvoiceNotificationWriterTest **6/6** (67 total, 0 skipped).
- `homespace-phase4-pg1.log`: PG class first run 12 run, 4 failures — all test problems (outbox not cleared between tests; one muddled assertion). Fixed. `homespace-phase4-pg2.log`: `MonthlyInvoiceNotificationPostgresTest` **12/12, 0 skipped**.
- New/extended Core tests: 17 new cases in MonthlyBillingServiceTest (manual issue exact envelope/denied/replay, zero total silent, prepare/first-rent/draft silent, rollover issue ROLLED_OVER+ISSUED, catch-up drafts + suppression + landlord-only DEFERRED + repeat sync silent, lazy OVERDUE both parties then fee then action window once, reported/disputed/blocked-fee silent, request/approve/reject + denied, superseding reject silent, direct extend with/without request, expiry winning over overdue/fee, paid-closed silent, distinct overdue actions + single acknowledgement + replay, held-money and termination-entry silent, manual deferral replay, automatic rollover both parties once, action-required marker/deferred/pending/termination/held-money); 4 in UnilateralTerminationServiceTest (notice/review/withdraw/auto-end add no termination notice, rejected review silent, approved review emits only the financial child for ROLLOVER and PAYMENT_EXTENSION); supplement assertions added to two ContractLifecycleServiceTest cases (one tenant ISSUED, duplicate requestId and denied actor silent); `InvoiceNotificationWriterTest` (13 types, MANDATORY on all enqueue methods, recipients/dedupe, validation, no sensitive data, Java fixture generation); `InvoiceOutboxProbe` test fixture.
- PG cases (real locks): parallel lazy reads + scheduler → one draft and one DRAFT_READY; catch-up per-period drafts; manual issue racing the scheduler → one ISSUED and one payment; rollback after the ISSUED enqueue restores old invoice/payment/new draft and leaves zero rows, then success writes ROLLED_OVER + ISSUED; four concurrent readers → OVERDUE once per party and fee-driven AMOUNT_UPDATED exactly once next day (QR changed); TRANSFER_REPORTED freezes everything silently; extension request/approve/replay/denied; parallel readers expire a request once with expiry winning the tenant notice; action-required/ack race/deferral replay; MANDATORY refusal and unique event_id; broker-failure FIFO + keyed by invoice; ACK-before-DB-failure replays the same eventId.
- Actual Java envelopes for the consumer: `homespace-invoice-java-events.jsonl` (15 lines: 13 types, OVERDUE and DEFERRED once per party). Consumer report: Java → compiled `dist` check passed (15 lines, 13 types, unique event ids, exact singleton/data/metadata/routes).

### Reported by the other workers (not re-run by the Core owner)
- Consumer: 13 types, 344 Jest, build, oxlint and a real isolated Kafka/Mongo smoke passed. `npx tsc` is NOT clean: only the two pre-existing untouched `admin-broadcast` spec errors (`admin-broadcast.service.spec.ts(57,31)` TS2345 missing `isValidActionPath`; `admin-broadcast.controller.spec.ts(14,44)` TS2345 `never`), no diff in those files.
- Web: 113 tests 0 failures, scoped lint and full tsc passed; two review bugs fixed. No browser visual test.
- Web final fix (accepted by Codex, dispatch `ctx_1302e8cdc9ec`, reported by that worker, not re-run by the Core owner): the synthetic first-rent invoice query is fixed; 34 focused tests, lint and full tsc passed, with a mutation regression check.

## Acceptance record
- Accepted locally by Codex: writer, publisher, MonthlyBillingService/ContractLifecycleService hooks, the narrowed acknowledgement scope (only PAYMENT_REQUEST, EXTENSION_PROPOSAL, MUTUAL_TERMINATION_PROPOSAL, LEGAL_REVIEW notify the landlord; termination/system entries stay silent for Phase 6) and the explicit-reject case (AMOUNT_UPDATED may follow EXTENSION_REJECTED only when the catch-up fee really changed the payment amount).
- Consumer and web evidence above, plus the final web synthetic first-rent query fix, accepted as reported.
- Rollout order unchanged: consumer, then web, then Core. Not committed, pushed or deployed.
- Pending: Phase 5 (move-in; core audit `ctx_e369782f2ab3` started, web audit `ctx_286b554327d0` finished) and Phase 6 (staged contract lifecycle, including the termination/legacy-mutual/draft-trim inventory above). The Phase 4 limits below are preserved, not resolved.

## Limits and unverified risks (honest)
- Auto-issue time and missing meters: docs say 10:00 and "keep draft"; source auto-issues from 00:00 of the day after the period and auto-fills missing readings with zero usage (flagged), stalling only on STATE_WATER_RATE charges, an incomplete previous period or incomplete terms. NOT changed; copy is generic.
- Not run: the gated historical PG classes (`ContractLifecyclePhase03PostgresTest`, `RentalWorkflowPostgresTest`, `ComplaintCasePostgresTest`, `RentalWorkflowHttpSystemTest`) — they require other databases that were not authorized; only their wiring was updated and compiled. The new PG class does exercise real `MonthlyBillingService` and `ContractLifecycleService` Spring wiring with the writer.
- The supplement hook is covered by unit tests only (no PG race for `issueFinalCosts`). The publisher was tested with a mocked `KafkaTemplate`; no real broker in Core tests.
- Catch-up: a newly issued invoice that is already past the action-window milestone does not send ACTION_REQUIRED in its issuing transaction (the owner has the DRAFT/auto state and later actions); no historical backfill is promised.
- A burst of notices is possible after downtime (one DRAFT_READY per missed period, FIFO per invoice).
- Phase 3 payment-overdue/QR side effects are unchanged and send nothing here.
- Not tested: live provider/bank, real push, browser UI.
