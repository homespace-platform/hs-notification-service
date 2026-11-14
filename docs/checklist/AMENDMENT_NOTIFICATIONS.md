# Phase 6B — Contract amendment notifications

**Status (2026-11-14): ACCEPTED locally by Codex.** Core owns transitions, notification service owns payload validation/copy, web owns authorized navigation and live refresh. This phase follows accepted 6A; no commit, push or deployment.

## Audited transitions and decisions

All events use `CONTRACT`/`NORMAL`, exactly one persisted root-contract party per envelope, `data` exactly `{contractId}` and the existing transactional contract outbox. Action path `/dashboard/contracts/<encoded contractId>`; the web resolves the viewer's side from the authenticated account and persisted parties. The only child event is the existing 6A `AGREEMENT_REVIEW_READY` with exact AMENDMENT agreement id, now extended to this kind after tenant approval. No reason, terms, effective date, amount, evidence or signature is carried in Kafka.

| Committed transition | Recipient | Event | Notes |
|---|---|---|---|
| Landlord `propose` inserts REQUESTED (also replacement) | tenant | `AMENDMENT_RESPONSE_NEEDED` | Duplicate request id and private draft are silent. New proposal makes a prior SCHEDULED proposal superseded later; no extra notice. |
| Tenant `requestNegotiation` inserts TENANT_REQUESTED | landlord | `AMENDMENT_RESPONSE_NEEDED` | Duplicate request id silent. |
| Landlord `decideNegotiation` accepts/rejects | tenant | `AMENDMENT_DECIDED` | Tenant sees actual status; accepted request is not yet a signed amendment. |
| Tenant `decide` rejects or requests changes | landlord | `AMENDMENT_DECIDED` | Cancellation of a child is internal; no signing success claim. |
| Tenant `decide` approves and child agreement is created | landlord | 6A `AGREEMENT_REVIEW_READY` / AMENDMENT | Exact signing child route. Replay of APPROVED silent. |
| Proposer withdraws an open proposal | other party | `AMENDMENT_WITHDRAWN` | Only after actual WITHDRAWN save. |
| `syncLocked` moves an unsigned proposal or tenant request to EXPIRED/TENANT_EXPIRED | both parties | `AMENDMENT_EXPIRED` | One per party on the transition, regardless of GET/scheduler caller; no repeat. |
| SmartCA verifies both signatures, `signed` moves APPROVED -> SCHEDULED | both | existing 6A FULLY_SIGNED / AMENDMENT | No separate scheduled event; status is visible on open. |
| `syncLocked` moves SCHEDULED -> APPLIED | both | `AMENDMENT_APPLIED` | May create a separate Phase 3 deposit-adjustment payment notice; neither event implies payment success. |

No notification for preview, save/discard draft, GET without a transition, validation failures, partial/pending signatures, failed transaction or retry. Root amendment view refreshes on root events; exact child remains accessible through the 6A route. Hidden tabs coalesce refresh until visible.

The old Phase 5 handoff guessed that an applied amendment invalidates a PROPOSED move-in handover. The source proves the root's signed `currentRevisionId` stays unchanged (`ContractTermsResolver` explicitly selects effective child snapshots), and `MoveInHandoverService` checks that root id. Therefore the handover proposal remains confirmable and there is **no invalidation transition to notify**. If business rules later change this invariant, re-audit the handover state first.

Pre-existing cancellation behavior can mark `PROVIDER_SIGNED`/`EMBEDDING` requests CANCELLED when an amendment is withdrawn/expired; no completion notice is sent. This phase does not change that legal/signature workflow. Review it separately before representing a VNPT signature as void.

## Evidence and acceptance

- [x] Core state and recipient audit; event contract frozen before implementation.
- [x] Core hooks and writer; focused replay, expiry, applied and rollback checks.
- [x] Consumer strict parser/copy and isolated Kafka/Mongo smoke.
- [x] Web tags, authorized landing and live refresh; focused tests.
- [x] Actual Java envelopes parsed by the compiled consumer; root review and local acceptance.

`hs-core-api/hs-contract-service`: `AmendmentNotificationWriter` writes singleton root-party envelopes into the existing MANDATORY outbox. `ContractAmendmentService` hooks every transition in the matrix. Tenant approval reuses 6A review-ready on the exact persisted child. The full-signed event remains 6A and is not duplicated at SCHEDULED. The outbox does not hold private proposal content.

`hs-notification-service`: five closed types with exact root-id data and fixed copy/route; 6A review-ready now accepts AMENDMENT. `hs-web-app`: five subtype tags and a scoped root change signal refresh the amendment workspace and deposit-adjustment payment panel; existing authenticated landing verifies the persisted parties.

Verification actually run: Core `ContractAmendmentServiceTest` 47/47, `AmendmentNotificationWriterTest` 4/4 and updated 6A writer 5/5; two PostgreSQL atomicity cases (agreement and amendment) passed on `core_notification_rollout_test_33add50a2fa8` with exact URL asserted; no skips. Five actual Java envelopes in `C:/Users/nvmin/AppData/Local/Temp/homespace-amendment-java-events.jsonl` passed the compiled consumer parser. Consumer 99 focused Jest cases, Nest build and scoped oxlint passed; isolated real Kafka/Mongo `npm run test:backend` passed the five new types and prior families. Web 29 focused agreement/handover/comparison cases plus 20 lifecycle cases, full TypeScript and scoped ESLint passed.

Unverified: live SmartCA/browser/FCM and a full service deployment. The pre-existing cancellation of `PROVIDER_SIGNED`/`EMBEDDING` requests on amendment withdrawal/expiry was not changed; this may require a separate legal/provider audit. No new advance deadline reminder was added.
