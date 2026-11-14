# Phase 6E — Return, deposit settlement and resulting payment obligations

**Status (2026-11-14): ACCEPTED locally by Codex after Core/consumer/web implementation and review.** Matrix was frozen before implementation; all three workstreams now have passing focused evidence. Inputs: three independent audits in TEMP/hs-phase6e-*-audit.md. This matrix supersedes their proposed names/recipients. L3: contract/money/identity/transaction/Kafka. Repositories: hs-core-api (contract + payment ownership), hs-notification-service (consumer), hs-web-app (authorized surfaces). No commit/push/deploy.

All new envelopes retain v1 and existing topics/outboxes. Singleton persisted recipient; immutable eventId per actual transition. Root data/metadata EXACT `{contractId}`, CONTRACT/NORMAL, Kafka key=root id. Payment data/metadata EXACT `{paymentId}`, PAYMENT/NORMAL, key=payment id. Fixed routes below; no amount, note, reason, business date, evidence, signature, side, actor or supplied URL in Kafka. Existing Phase3/4/6D outcomes remain distinct; no delivery-order inference.

Routes: R=`/dashboard/contracts/<encoded root>` for physical return (also works for TERMINATED); S=`/dashboard/invoices/<encoded root>?section=deposit` for ordinary settlement (EXPIRED/CLOSED); P=`/dashboard/payments?paymentId=<encoded id>` for actual monetary obligation. All pages verify current viewer against persisted authorized data.

| Committed transition | Recipient | Event | Route / consolidation |
|---|---|---|---|
| First EARLY_EXIT CONFIRM_RETURN, one timestamp recorded | Other party | LEASE_RETURN_CONFIRMED | R; one side recorded confirmation, no bilateral claim. |
| Second CONFIRM_RETURN -> RETURNED | Other party | LEASE_RETURN_COMPLETED | R; replace CONFIRMED for completing action. |
| Unilateral completeUnilateralHandover successfully records handoverAt after prior ENDED | Tenant | LEASE_RETURN_COMPLETED | R; copy says return was recorded, does not assert bilateral agreement. |
| Legacy complete/force ends ACTIVE and records physical return together | Both | Existing TERMINATION_ENDED only | No duplicate return event. |
| Ordinary owner closure proposal/reproposal increments version | Tenant | SETTLEMENT_RESPONSE_NEEDED | S, including replacement of PROPOSED/DISPUTED. Suppress complaint-sourced caseId != null. |
| Tenant disputeClosure -> DISPUTED | Landlord | SETTLEMENT_DISPUTED | S, domain decision only; no complaint progress payload. |
| New final-cost supplement invalidates prior PROPOSED/DISPUTED -> WAITING_HANDOVER | Tenant | SETTLEMENT_PROPOSAL_INVALIDATED | S, plus existing exact INVOICE_ISSUED; separate consequences. WAITING_HANDOVER/replayed supplement has no reset event. |
| Tenant acceptance creates positive landlord-to-tenant DEPOSIT_REFUND | Payer=landlord | Existing PAYMENT_REQUEST_CREATED on actual insert | P; this is the owner's actionable acceptance cue, suppress root SETTLEMENT_AGREED. |
| Tenant acceptance creates positive tenant-to-landlord OTHER_CHARGE balance | Payer=tenant; landlord | PAYMENT_REQUEST_CREATED to payer; SETTLEMENT_AGREED to landlord | P / S. |
| Acceptance requires no money -> CLOSED | Both distinct parties | LEASE_CLOSED | S only; no AGREED, payment or fake receipt. |
| Existing sync observes actual settlement receipt CONFIRMED -> CLOSED | Both distinct parties | LEASE_CLOSED | S once; Phase3 receipt fact remains separately notified. |
| First responseOverdueAt while ordinary PROPOSED | Tenant | SETTLEMENT_RESPONSE_OVERDUE | S; deadline attention, never consent. |
| First responseOverdueAt while ordinary DISPUTED | Landlord | SETTLEMENT_RESPONSE_OVERDUE | S; reconcile/revise. Complaint-sourced proposals suppressed; preserve existing marker/state logic. |
| First closure overdueLoggedAt after accepted refund/balance deadline | Stored payment payer | SETTLEMENT_PAYMENT_OVERDUE | S; neutral reconciliation wording even for TRANSFER_REPORTED/DISPUTED. No second payment-overdue notice for the same closure obligation. |
| New nonzero deposit delta on amendment apply | Persisted payer, according to delta direction | Existing PAYMENT_REQUEST_CREATED on insert | P; no event on existing-row return; AMENDMENT_APPLIED remains. |
| New agreed early-exit rent refund | Persisted refund payer | Existing PAYMENT_REQUEST_CREATED on insert | P; hook scoped to createAgreedRentRefundObligation, not all cancellation refunds. |
| First actual AWAITING_TRANSFER/REJECTED -> OVERDUE for deposit delta or agreed early-exit rent refund | Persisted payer | PAYMENT_OBLIGATION_OVERDUE | P; no repeat on later reject/report cycles. Proof-pending/disputed/confirmed/cancelled status unchanged. |

New root event set (nine): LEASE_RETURN_CONFIRMED, LEASE_RETURN_COMPLETED, SETTLEMENT_RESPONSE_NEEDED, SETTLEMENT_DISPUTED, SETTLEMENT_PROPOSAL_INVALIDATED, SETTLEMENT_AGREED, SETTLEMENT_RESPONSE_OVERDUE, SETTLEMENT_PAYMENT_OVERDUE, LEASE_CLOSED. One new payment type: PAYMENT_OBLIGATION_OVERDUE. Reuse PAYMENT_REQUEST_CREATED for the three new obligation insertion paths; do not duplicate common transfer/receipt/dispute notices.

## Deadline ownership and bounded execution

Cover delta and agreed-rent-refund deadlines, including obligations still pending after parent closure/termination. Reuse the existing lifecycle scheduler and business clock, with a bounded stable-id candidate sweep; no new scheduler or advance reminders. Select due deposit adjustments and contract-bound rent-refund candidates, lock owning root then payment consistently, recheck status/date/identity under lock. For INITIAL_PAYMENT_REFUND require owning root's agreed early-exit state and matching contract/rental; cancellation-only refunds remain excluded. Never expire/cancel a transfer or auto-confirm possession/receipt.

Use the existing durable payment OVERDUE audit fact to suppress a second deadline notice after a later rejection cycle (query its existence under the payment lock before first transition), keeping status transition/audit/outbox atomic. No schema change is required for this marker. Existing already-OVERDUE rows are not backfilled. The closure refund/balance stays governed by its existing overdueLoggedAt and gets only SETTLEMENT_PAYMENT_OVERDUE. New early-exit refund deadline type must not accidentally broaden ordinary cancellation refund handling.

## Copy, web and scope decisions

LEASE_CLOSED means the deposit-settlement record closed; it must not claim all independent rent refunds/debts are paid. LEASE_RETURN_COMPLETED says return was recorded; unilateral recording does not establish bilateral assent. Deadline copy says inspect current obligation, never that a transfer was absent. Signature completion is not physical return.

Web adds closed subtype classifiers/tags and scoped agreement/payment signals before hidden-tab gating, with no unread-title feedback. Matching invoice signals also refresh the settlement proposal state/version after final costs. Selected authorized settlement/refund/adjustment payment panels must refresh on matching/generic payment signals, coalesce work while hidden and preserve typed proof/drafts/version-bound consent. Fix payment action links: DEPOSIT_ADJUSTMENT invoiceId is not a monthly invoice id; settlement refund/balance should open deposit section; early-exit rent-refund action must reach the authorized early-exit/refund panel, preserving pre-tenancy cancellation routes. Use authorized data/on-demand resolution if needed rather than guessing cause from the shared refund type; avoid list-wide extra requests or a new API field unless coordinated.

Coordinator clarification (worker question msg_cec9e299d6d1): current DTOs do not expose a trustworthy refund cause; the early-exit refund list also includes all rental refunds. Reuse existing SettlementPaymentPanel on demand for the explicitly selected INITIAL_PAYMENT_REFUND from the verified viewer's authorized payment list. Use generic refund wording for that type, preserve the ordinary cancellation link, and do not infer cause or extend Core DTOs. Derive role/direction from persisted payer/payee; key the panel by account/payment id, preserve amount recheck/proof/receipt/dispute guards, and test selection/account changes, outsider/unknown ids and live refresh. This adds a destination for the existing operations, not a new financial business operation.

Excluded: complaint opening/evidence/escalation/admin proposal/approval/progress, KYC, chat, automatic possession/receipt, changed financial/legal rules, new reminders, backfill, provider integration. Ordinary acceptance/payment obligations/closed consequences remain included even if a previous complaint existed. Preserve all business validation/holds. Natural expiry has no separate physical-return action; do not invent one. Existing independent rent-refund/CLOSED ordering in the workflow is a documented business limitation, not a reason to claim all money complete.

## Acceptance

- [x] Three audits reviewed; matrix/recipients/identity/routes/consolidation frozen before code.
- [x] Core hooks, payment creation and bounded deadline ownership implemented.
- [x] Focused replay, both directions, zero money, denial and atomicity checks.
- [x] Consumer exact parser/templates, Java fixture crosscheck and isolated Kafka/Mongo smoke.
- [x] Web authorized action routes, refresh/hidden recovery/draft safety checked.
- [x] Root review, final checklist and memory; report remaining limits.

Consumer evidence (`ctx_0b021c16abf4`): 13 event-module suites, 616 tests passed, zero skipped; Nest build passed. Isolated real Kafka/Mongo smoke passed ten new types, replay/authorization/routes/preferences and thirteen invalid redacted-DLT cases plus prior families. All ten actual Java fixtures passed final compiled parser/renderer checks (nine root, one payment). Scoped lint passed with one unchanged fetch-helper warning; whitespace passed. Root inspected the strict parser family and copy/routes against this matrix. Global test tsc with known unrelated broadcast-spec errors and live provider/browser/FCM remain unverified. Source report: TEMP/hs-phase6e-consumer-implementation-report.md. This is consumer acceptance only.

Web evidence (`ctx_43c7f1f5f8f0`, recovered from interrupted predecessor): 107 distinct focused cases have passing evidence across documented runs; two fixture expectation failures corrected and affected cases rerun. Final-source TypeScript, scoped ESLint and whitespace passed. Root reviewed fixed deposit-vs-monthly routes, authorized on-demand generic refund action panel, live amount/party/status recheck and unmount guards, and shared coalesced signal hook. Scope includes root/payment/invoice refresh, proposal invalidation and consent reset, preserved evidence/cost/proof/mobile drafts, identity/account/selection isolation, and narrow CLOSED copy. No browser/backend/provider verification by this worker. Report TEMP/hs-phase6e-web-implementation-report.md. Core acceptance still pending; this is not whole-phase completion.

## Final Core evidence and acceptance

Core (`ctx_cf2a77afeb4a`, resumed same task after predecessor exited): 42 distinct PostgreSQL cases and 16 distinct service unit cases have passing evidence, zero skipped; four inherited writer/export checks passed. Tests exercise both return orders/denials, state+outbox rollback/retry, proposal/reproposal/dispute/invalidation versions, refund/balance/zero/no-deposit closure, complaint exclusions, actual receipt versus proof, pending proof/dispute deadline neutrality, and 105 independent obligations per CLOSED/TERMINATED parent with stable paging, party/linkage/status/date guards, cancellation exclusion and rejection-cycle dedupe. Every PG invocation asserted the exact authorized disposable database URL; no business database was used. Final API test compilation and whitespace checks passed.

Failures were diagnosed and resolved in fixtures: quoted Maven property needed in PowerShell; explicit cancellation-key stub for strict Mockito agreed-refund replay; four supplement assertions incorrectly checked invoice events by root Kafka key (corrected to embedded contractId). Only affected/new cases reran. No unresolved failing case remains. Actual commands and logs: TEMP/hs-phase6e-core-implementation-report.md. Earlier successful unchanged tests were not rerun.

Root reviewed return recipient/consolidation hooks, ordinary-versus-complaint proposal/deadline guards, refund/balance acceptance, zero-cash/lazy closure, actual-insert-only payment notices, MANDATORY writers and bounded deadline query/lock/recheck/audit dedupe against the frozen matrix. Crosschecked consumer exact keys/routes/copy and web authorized action/sync evidence. All three parts accepted locally on 2026-11-14; Phase 6E and the planned Phase 1–6 notification rollout are complete in source and focused local verification.

## Deployment and remaining limits

Deploy only when separately authorized, in order **all notification consumer replicas -> web -> Core**. Old strict consumers quarantine unknown types/kinds and commit their offsets; retain source events for immutable-eventId replay. No commit, push or deployment was performed.

Not executed: live browser/Gateway HTTP system boot, SmartCA/bank/FCM, full reactor/full-service suites, legacy database slices, production records or competing-scheduler/load stress. Real PostgreSQL row locks and transaction rollback were exercised; source review confirmed root-before-payment locking. Existing independent rent-refund versus CLOSED business ordering remains; closure copy explicitly describes deposit settlement only. No historical backfill or advance reminders. KYC/chat/complaint workflow notification integration remains excluded; domain settlement dispute and accepted financial consequences are included as specified. The earlier provider-signed amendment cancellation limitation remains a separate legal/provider review item.
