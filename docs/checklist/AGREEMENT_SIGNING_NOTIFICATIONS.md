# Phase 6A — Agreement signing notifications

**Current status (2026-11-14): ACCEPTED locally by Codex.** Core, consumer and web implementations were reviewed against the frozen matrix below. No commit, push or deployment was performed. Phases 6B–6E remain open.

`TEMP` = `C:/Users/nvmin/AppData/Local/Temp`. Audits (proposals only, decisions below override them): `TEMP/homespace-phase6a-core-signing-audit.md`, `homespace-phase6a-core-signing-supplement.md`, `homespace-phase6a-consumer-web-signing-audit.md`.

- [x] Audits read; contract frozen by root (below, written BEFORE code).
- [x] Core writer + hooks.
- [x] Core focused tests and real PostgreSQL transaction test.
- [x] Actual Java JSONL generated and parsed by the compiled consumer.
- [x] Consumer parser/templates/smoke and authorized web landing/sync.
- [x] Root review and local acceptance.

## Frozen V1 contract

Four new v1 types, category `CONTRACT`, priority `NORMAL`: `AGREEMENT_REVIEW_READY`, `AGREEMENT_SIGNING_TURN`, `AGREEMENT_FULLY_SIGNED`, `AGREEMENT_SIGNATURE_NEEDS_REVIEW`. Exactly one persisted party per envelope. `data` exactly `{agreementId, agreementKind}`; consumer metadata the same. `agreementId` = the EXACT signing envelope (child ids allowed, never the root for a child). `agreementKind` is the closed enum `LEASE | DEPOSIT | AMENDMENT | RENEWAL | EARLY_EXIT` (the former `MOVE_IN` kind and `MOVE_IN_HANDOVER_READY` were removed with the move-in handover feature; the parser rejects them). A persisted kind `WORKFLOW` is resolved through `WorkflowSigningDocument`/its workflow record (never from the `BB-`/`CT-` number prefix). Children must match the parent's parties or the transaction fails. Outbox/publisher/topic are reused (`contract_notification_outbox`), `aggregate_id` = agreementId; **no ordering promise** against invoice events or between a root and its child envelopes. No private text/date/amount/signature/failure code in payload. Legacy `CONTRACT_*` types untouched. Deploy order consumer → web → Core.

Routes (built by the consumer): `/dashboard/contracts/<enc agreementId>` for every kind.

`EARLY_EXIT` is deliberately deferred ENTIRELY to Phase 6D (turn, failure and completion notices included): Core resolves the kind, skips every notice for it and keeps its business flow (including `MutualTerminationService.act(ACCEPT)`) unchanged.

## Frozen trigger matrix

| # | Trigger (committed transition only) | Recipient | Event / kind |
|---|---|---|---|
| 1 | system root-lease `createDraftFor` actual insert (`currentUserId == null`) | landlord | REVIEW_READY / LEASE (incomplete PDF is fine; copy only says review-ready). Manual/self/existing/retry/error: silent |
| 2 | FIRST actual deposit PDF success in `prepareDepositPreviewAutomatically` when the actor is system (no `UserContextHolder` user) or the tenant | landlord | REVIEW_READY / DEPOSIT. Landlord-self or manual render first: silent; failed render, repeat: silent. First matching PDF detection and rental/contract locks preserved |
| 4 | SmartCA landlord signature finalized/embedded/verified (`finalizeSignedRequest` landlord branch), all supported kinds | tenant | SIGNING_TURN. No notice at provider-pending / `PROVIDER_SIGNED` / initiate |
| 5 | deposit reopen (`DepositAgreementService.reopen`), once per actual valid reopen | tenant | SIGNING_TURN / DEPOSIT |
| 6 | INTERNAL root-lease `sendToTenant` | tenant | SIGNING_TURN / LEASE, neutral copy (no crypto claim). Child send dead end: business as-is, silent |
| 7 | SmartCA tenant signature finalized and root lease becomes ACTIVE | both persisted parties (singleton envelope each, deduplicated on the same identity) | FULLY_SIGNED / LEASE (the existing generic notice; the former landlord-only handover prompt was retired). INTERNAL root `sign` ACTIVE: actor synchronous, silent. No self-role duplicates |
| 8 | SmartCA both signed DEPOSIT / AMENDMENT / RENEWAL | both parties (singleton each) | FULLY_SIGNED; copy says signatures verified, never terms effective or money received |
| — | EARLY_EXIT in every trigger above | — | silent; deferred to 6D |

Silent: GET, provider-pending, `PROVIDER_SIGNED`, `EMBEDDING`, REJECTED, user-EXPIRED (5 min), CANCELLED, synchronous `VNPT_REJECTED`, embedding attempts 1-2, transient poll errors, replays, rollbacks, denied/validation errors.

## Frozen async failure matrix (signer only)

`AGREEMENT_SIGNATURE_NEEDS_REVIEW` to the signer's persisted party on an ACTUAL transition to `FAILED` in: provider `updateAfterPoll(FAILED)`; expired `handlePollFailure` (`PROVIDER_STATE_UNKNOWN`); terminal `markEmbeddingFailed` (attempt ≥ 3); stale-exhausted `EMBEDDING_STUCK`. Signer resolved from the stored role → contract party and verified equal to `req.signerUserId`; a mismatch sends nothing and logs a code-only warning. Copy neutral (request needs checking / open current status / support); no valid/invalid assertion, no retry promise, no failure code. Once-only and atomic: `markEmbeddingFailed` locks and re-checks (no FAILED resurrection, no second notice); stale exhaustion uses portable stale-id selection plus a per-row locked transaction with re-check and identical field writes inside the existing scheduler step (no new scheduler). Late finalize/cancel must not resurrect FAILED/CANCELLED. No row lock is held across provider calls; lock ordering preserved.

## Core implementation

`hs-core-api/hs-contract-service`: `AgreementSigningNotificationWriter` writes one party per v1 envelope to the existing transactional outbox. Hooks cover system-created root drafts, first deposit PDF, INTERNAL send/reopen/activation, verified SmartCA transitions and four terminal async failure paths. Late embedding failure cannot resurrect an already failed or cancelled request.

`hs-notification-service`: closed type/kind validation, fixed neutral copy and authorized action paths. `hs-web-app`: verified party landing, and coalesced visible-tab refresh of mounted agreement views.

## Verification actually run

_Counts predate the move-in handover removal and may include now-removed handover cases; they were not re-run._

- Core: `AgreementSigningNotificationWriterTest` 5/5, `SmartCaPollingOutcomeTest` 14/14, `ContractServiceImplTest` + two signature isolation classes 39/39, `RentalWorkflowPostgresTest` 86/86, and `AgreementSigningNotificationPostgresTest` 1/1 on the exact allowlisted disposable DB `core_notification_rollout_test_33add50a2fa8`; `hs-api-service` dependent `test-compile` passed. No skip in these runs.
- Actual Java JSONL: `C:/Users/nvmin/AppData/Local/Temp/homespace-agreement-java-events.jsonl`, 9 envelopes covering four new types and five kinds; every line was accepted by the compiled consumer parser with matching metadata.
- Consumer: notification-event Jest suite 485 passed; Nest build and scoped oxlint passed; isolated real Kafka/Mongo `npm run test:backend` passed with the new agreement cases. The global TypeScript check retains two existing `admin-broadcast` spec errors.
- Web: agreement navigation/sync 5/5, workflow-document 3/3, deposit agreement 11/11, contract-lifecycle and handover 40/40, other adjacent contract/payment cases 20/20; full `tsc --noEmit` and scoped production ESLint passed. Legacy CJS test files fail the repository's ESLint `no-require-imports` rule (existing test format), so lint was scoped to production files and the new MJS test.

## Known limits / handoffs

- **6B/6C**: completion de-duplication (FULLY_SIGNED AMENDMENT/RENEWAL vs their own "scheduled/applied" events), the landlord's first turn after an approval, and cancelled provider signatures (`ContractAmendmentService.cancelAgreement` cancels `PROVIDER_SIGNED`/`EMBEDDING` requests, discarding a valid VNPT signature) are handed off.
- **6D**: ALL EARLY_EXIT notices (REVIEW_READY, SIGNING_TURN, FULLY_SIGNED, NEEDS_REVIEW, including failures) are deferred; Core resolves the kind and skips it.
- **6E**: return and final settlement.
- Legacy `CONTRACT_AWAITING_SIGNATURE/SIGNED/EXPIRED` stay dormant and untouched.
- Real SmartCA/FCM/browser delivery and a live end-to-end user session were not exercised. Existing provider, database and Kafka failure behavior remains governed by the outbox and current retry process.
