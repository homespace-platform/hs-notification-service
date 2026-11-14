# Phase 6D — Lease termination notifications

**Status (2026-11-14): ACCEPTED locally by Codex after parallel Core/consumer/web review.** Audit covers the current EARLY_EXIT workflow, unilateral overdue decision, reachable legacy mutual overdue path, and natural lease expiry. Return/handover and financial settlement are Phase 6E. Complaint/KYC/chat remain excluded.

All root events are `CONTRACT`/`NORMAL`, one persisted landlord or tenant per envelope, data exactly `{contractId}`, fixed authenticated `/dashboard/contracts/<id>` route, and transactional outbox keyed by root contract id. The route exposes the current authorized contract, workflow and invoice panels; copy carries no reason, money, date or assertion of payment/physical return.

| Transition | Recipient | Event |
|---|---|---|
| `MutualTerminationService.propose`, including counterproposal | other persisted party | `TERMINATION_RESPONSE_NEEDED` |
| `act(ACCEPT)` | proposer | `TERMINATION_AGREED` (signed path consolidated with exact-child signing completion) |
| `act(REJECT)` / `act(WITHDRAW)` | proposer / other party | `TERMINATION_DECLINED` / `TERMINATION_WITHDRAWN` |
| Legacy `MonthlyBillingService.proposeMutualTermination` | tenant | `TERMINATION_RESPONSE_NEEDED` |
| Legacy accept / decline / withdraw | landlord / landlord / tenant | `TERMINATION_AGREED` / `TERMINATION_DECLINED` / `TERMINATION_WITHDRAWN` |
| `issueUnilateralTermination` | tenant | `TERMINATION_NOTICE_ISSUED` |
| `requestTerminationReview` | landlord | `TERMINATION_REVIEW_REQUESTED` |
| `decideTerminationReview` approves alternative | tenant | `TERMINATION_REVIEW_APPROVED` (Phase 4 also notifies financial outcome) |
| Withdraw or payment-confirmed cancellation of unilateral notice | tenant | `TERMINATION_NOTICE_CANCELLED` |
| Review denial or 24-hour `syncUnilateral` auto end | both | `TERMINATION_ENDED` |
| Legacy complete/force termination | both | `TERMINATION_ENDED` |
| `ContractLifecycleService.syncLocked` ACTIVE -> EXPIRED (natural or agreed early date) | both | `LEASE_EXPIRED` |
| Verified EARLY_EXIT signing child: review/turn/fully signed/failure | corresponding persisted child party | Existing 6A signing family extended to `EARLY_EXIT`; exact child route. |

The current mutual AGREED status does not terminate the contract or confirm return. An overdue unilateral ENDED status terminates the lease but does not confirm vacant possession, cede debt or finish settlement. Legacy complete/force includes physical return and retained deposit in one transaction; root copy remains neutral. A paid invoice cancels the pending proposal only on an actual cancellation transition; phase 4 receipt remains separate. No new notice for GET without transition, retry, validation denial, provider poll, draft invoice cancellation, internal audit log entry or complaint result. Return confirmations, final rent refund obligations, deposit proposal/decision, final cost invoice, financial deadlines and closure are deferred to 6E.

## Acceptance

- [x] Audit and freeze trigger/recipient/route matrix before coding.
- [x] Core hooks and focused transition/replay/rollback checks.
- [x] Consumer strict parser, templates and isolated smoke.
- [x] Web tags, refresh and authorized route checks.
- [x] Actual Java envelope compatibility and root review.

Consumer acceptance evidence (Codex worker `ctx_265289a6e83d`, 2026-11-14): 22/22 actual Java envelopes passed the compiled parser/renderer crosscheck (10 termination, 12 signing including EARLY_EXIT), with exact keys, singleton recipients, source identity, fixed routes and metadata. Scoped oxlint passed with one unchanged generic smoke-helper warning; scoped whitespace check passed. No runtime defect found. Prior 112 focused Jest cases, Nest build and isolated real Kafka/Mongo smoke remain valid because this worker changed documentation only. Core/web final review remains pending; this is not whole-phase acceptance.

Final Core review (`ctx_eade2219b648`): fixed verified EARLY_EXIT completion when source already AGREED/RETURNED, and payment-driven legacy/unilateral cancellation in the lifecycle path. Updating the unilateral notice to CANCELLED_PAID prevents billing reconciliation announcing it twice. Seven targeted unit cases and six PostgreSQL integration/rollback/replay cases passed, zero skips, only the exact authorized disposable DB. API test compilation and whitespace passed. Prior 86 workflow PG + four writer atomicity PG cases passed before these final fixes; only affected cases were rerun. Prior focused unit evidence had one random UUID assertion false positive, fixed to inspect data only and its single test passed. Root reviewed the changed committer and cancellation guards and accepted the evidence.

Final web review (`ctx_747d72cdf033`): persisted root identity now scopes early-exit refresh even without a caller prop; exact authorized EARLY_EXIT child opens its document UI; document events refresh parent workflow without callbacks after unmount; generic lifecycle recovery and invoice contract-state refresh added. Sixty-six distinct focused cases have passing evidence across the documented runs (one stale fixture expectation corrected and its case rerun), full TypeScript, scoped ESLint and whitespace passed. Root reviewed authorized landing and matching-root subscriptions. No live browser/SmartCA/FCM, deployment or business DB was used; older slice contexts were compiled rather than booted. Source reports: TEMP/hs-phase6e-{core,consumer,web}-audit.md. Phase 6E is next, governed by its own frozen matrix.
