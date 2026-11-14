# Phase 6C — Lease renewal notifications

**Status (2026-11-14): ACCEPTED locally by Codex.** Audited `ContractLifecycleService` request/decision/signature/sync and the renewal panel before coding. No commit, push or deployment.

All new root events are `CONTRACT`/`NORMAL`, one persisted root party per envelope, data exactly `{contractId}`, fixed authenticated route `/dashboard/contracts/<encoded contractId>`, existing transactional contract outbox and Kafka key = root id. The 6A signing family continues to use the exact child agreement id. No free text, months, dates, rent, payment, signature or actor in Kafka.

| Actual transition | Recipient | Event | Why |
|---|---|---|---|
| Tenant inserts REQUESTED via `requestRenewal` | landlord | `RENEWAL_REQUESTED` | Landlord must decide; invalid/second requests silent. |
| Landlord decides REJECTED | tenant | `RENEWAL_REJECTED` | Shows decision; no invented reason. |
| Landlord approves and creates child agreement | tenant | `RENEWAL_APPROVED` | Approval does not yet extend the lease. |
| Same approval | landlord | Existing 6A `AGREEMENT_REVIEW_READY` / RENEWAL | Exact child signing document needs landlord review; 6A kind allowlist extends to RENEWAL in this phase. |
| `syncLocked` REQUESTED/APPROVED -> EXPIRED, including parent no longer ACTIVE | both | `RENEWAL_EXPIRED` | Once per actual transition, regardless of GET/scheduler/termination caller. Child cancellation and parking release have no extra notice. |
| Verified SmartCA both signatures `applyRenewalAfterSignatures` -> APPLIED | both | Existing 6A `AGREEMENT_FULLY_SIGNED` / RENEWAL | No extra applied notice in the same transaction. Open the root renewal panel for the applied status; full-signed copy does not claim a payment. |

Silent: GET without transition, partial/pending/failed signing (6A handles signer failure), provider poll retry, replay, validation denial, unchanged terminal record, and new monthly rent obligations (Phase 4 billing/Phase 3 payment own them). Root renewal panel refreshes on root events as well as an already known child agreement id. A renewal extending the root changes `effectiveLeaseMonths` immediately when the verified signatures commit; there is no later effective-date scheduler for this family.

## Acceptance

- [x] State and recipient audit; matrix frozen before implementation.
- [x] Core hooks/writer and focused replay/expiry/atomicity checks.
- [x] Consumer strict parser/templates and isolated Kafka/Mongo smoke.
- [x] Web tags, scoped refresh and authorized route tests.
- [x] Java-produced envelope crosscheck and root review.

Core: `RenewalNotificationWriter` queues the four root outcomes in the existing MANDATORY outbox. `ContractLifecycleService` emits only after real transitions; landlord approval also queues 6A review-ready for the persisted RENEWAL child. Focused tests passed: 46 unit cases (37 lifecycle, 4 renewal writer, 5 agreement writer) and 7 cases including 3 PostgreSQL atomicity checks on the exact disposable `core_notification_rollout_test_33add50a2fa8` database. Four Java-produced renewal envelopes passed the compiled consumer parser and renderer.

Consumer: strict singleton/exact-root-data parser, fixed copy and route. 108 focused Jest cases, Nest build, scoped oxlint, and isolated real Kafka/Mongo `npm run test:backend` passed (4 renewal outcomes and all prior event families). Web: 49 focused tests, full TypeScript and scoped ESLint passed. Root/known-child lifecycle panels refresh via the existing coalesced agreement signal.

Unverified: live SmartCA, browser, FCM, and deployment. No new advance reminder scheduler. The existing provider-signed amendment cancellation semantics remain a separate risk. Next: 6D termination, then 6E return/final settlement.
