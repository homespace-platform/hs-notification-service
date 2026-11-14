# Phase 5 — Move-in handover notifications

**Current status (2026-11-14): ACCEPTED locally by Codex (root).** Codex reviewed the Core writer/hooks/committer, the final `selectedDatabaseName` test-gate fix (datasource allowlist preserved) and the web fixes (latest persisted proposal/evidence visible during editing; `acceptResult` tied to the returned revision/status) and accepted Phase 5 on 2026-11-14. This closeout was documentation only: no source, test or check was run for it. Consumer and web evidence below is quoted from their workers' reports, not re-run by the Core owner. Phase 6 is NOT started (see "Phase 6 staging").

Source audits: `TEMP/homespace-phase5-core-handover-audit.md` and `TEMP/homespace-phase5-consumer-web-handover-audit.md` (`TEMP` = `C:/Users/nvmin/AppData/Local/Temp`). Codex froze the contract below on 2026-11-14 after reading both. Honest note on order: the matrix text in this file was written by the Core owner from the frozen brief **after** the Core source and tests were finished (the first task step was code), so it is a faithful record of the frozen contract, not a pre-implementation gate.

- [x] Audit core lifecycle and every caller (core audit).
- [x] Audit consumer/web landing, refresh and copy (consumer/web audit).
- [x] Freeze trigger → recipient → event/data → route (Codex, below).
- [x] Core writer + hooks (this file, "Core implementation").
- [x] Core tests written and run (unit + real PostgreSQL, "Verification actually run").
- [x] Consumer implementation — reported passed by the consumer worker (see "Reported by other workers").
- [x] Web implementation — final worker evidence recorded below (quoted, not re-run by the Core owner).
- [x] Root review and acceptance — Codex accepted locally 2026-11-14 (this docs update records it).

## Frozen Phase 5 contract

Four new v1 types, category `CONTRACT`, priority `NORMAL`: `MOVE_IN_HANDOVER_PROPOSED`, `MOVE_IN_HANDOVER_CONFIRMED`, `MOVE_IN_HANDOVER_COMPLETED`, `MOVE_IN_HANDOVER_DISPUTED`.

Common: unchanged v1 envelope; exactly one persisted party per envelope; `data` exactly `{contractId}` (consumer metadata is the same); `contractId` is the **root lease contract** (never the `BB-` signing child); Kafka key and outbox aggregate = `contractId`; route `/dashboard/invoices/<encoded contractId>?section=deposit&workflow=move-in`. Reuses table `contract_notification_outbox`, the publisher and the topic. No dates, meters, inventory, keys, free text, reasons, names, actor/role/status/revision in the payload. Static neutral current-record copy; generic push unchanged. Deploy order consumer → web → Core (old strict consumers send unknown types to the DLT).

| # | Trigger (committed transition only) | Recipient | Event |
|---|---|---|---|
| 1 | every PROPOSE, including replacing PROPOSED, COMPLETED or DISPUTED (clears confirmations) | tenant | PROPOSED |
| 2 | every successful human first CONFIRM while still PROPOSED (tenant-first **and** landlord-first; Codex decision R7 = notify) | the other party | CONFIRMED |
| 3 | human CONFIRM that completes the handover | the other party only | COMPLETED |
| 4 | verified SmartCA completion (trusted committer path) | **both** parties, once each | COMPLETED; every intermediate CONFIRMED suppressed |
| 5 | REPORT_ISSUE when the status read before mutation is not DISPUTED (includes revision 0, which saves twice) | the other party | DISPUTED |

Silent: GET, PDF prepare/list, denied/stale/duplicate/validation errors, rollbacks, evidence attachments, complaint resolution, a repeated REPORT_ISSUE while already DISPUTED (business behaviour unchanged, notice silent), SmartCA completion when the handover was already COMPLETED. DISPUTED is a handover outcome, not a complaint-workflow notification (those stay excluded). No deadline, reminder, scheduler or backfill. Existing unusual re-propose and eligibility behaviour is preserved. Signature-driven mode is selected only by trusted in-process code, never by body, path or actor, and uses no ThreadLocal or global flag.

## Core implementation (hs-core-api, module hs-contract-service)

- New `com.hs.contract.notification.MoveInHandoverNotificationWriter` (`@Service`, both methods `@Transactional(propagation = MANDATORY)`, required constructor injection, no null guards): `enqueueOther(contract, actorId, event)` writes one envelope to the stored party that is not the actor (a self-owned lease with coinciding parties writes nothing; an actor that is not a stored party throws) and `enqueueBoth(contract, event)` writes landlord then tenant (coincident parties dedupe to one). Validation: contract and id present, `parentContractId == null` (root lease only), both party ids present. Recipients are the stored `landlordId/tenantId` of the locked contract, which `RentalWorkflowSupport.lock` already verifies equal the rental's `ownerId/renterId`. Data is `Map.of("contractId", id)`; `occurredAt` is UTC ms; no `metadata` key is produced by Core (the consumer derives it, as for earlier phases). No new table, publisher, scheduler or property.
- `MoveInHandoverService`: new `private final MoveInHandoverNotificationWriter notices`. `propose` calls `enqueueOther(... PROPOSED)` after `support.propose`. `act` now delegates to a private `apply(..., verifiedSignatures=false)`; a new public `confirmFromVerifiedSignatures(rental, actor, action)` (`@Transactional(MANDATORY)`) calls `apply(..., "CONFIRM", true)`. `apply` keeps every existing guard, lock, revision check and save; it reads `alreadyDisputed` before any mutation and enqueues after the final `support.save`: human non-completing CONFIRM → CONFIRMED to the other party; completing CONFIRM → COMPLETED to the other party, or to both when `verifiedSignatures`; non-completing CONFIRM with `verifiedSignatures` → nothing; REPORT_ISSUE with prior status ≠ DISPUTED → DISPUTED to the other party.
- `WorkflowDocumentCommitter` (the only signature-driven caller) now calls `handover.confirmFromVerifiedSignatures(...)` for the owner and the renter exactly under its existing hash check and "skip already confirmed party" conditions. The public `act` (REST handler) has no signature mode and cannot be switched into one by the action string.
- Fixtures: `RentalWorkflowPostgresTest` and `RentalWorkflowHttpSystemTest` `@Import` the new writer. No `new MoveInHandoverService(...)` / `new WorkflowDocumentCommitter(...)` exists anywhere (grep); the controller test mocks the service and `act`/`propose` signatures are unchanged.
- Nothing writes payment, deposit or contract state; the hooks are outbox inserts in the same transaction as the record change.

Surrounding-path review (grep of `"MOVE_IN"` and `handover.*` in all `src/main`): the record is written only by `MoveInHandoverService` (via `RentalWorkflowSupport.propose/save`), reached from the controller and the committer. `ComplaintCaseService` only reads it; `DepositAgreementService`, `AiContractQueryService` and the evidence checker are read-only; no scheduler touches it. No other path needed a hook.

## Verification actually run (Core owner; Maven serial; only `core_notification_rollout_test_33add50a2fa8`, exact URL asserted before every create-drop run; no real provider, broker or SmartCA)

| Run | Result | Log (`TEMP`) |
|---|---|---|
| `MoveInHandoverNotificationWriterTest` (unit, no DB) | 7/7 pass, 0 skip | surefire report (quiet run, no separate log) |
| 13 new Phase 5 cases of `RentalWorkflowPostgresTest` (focused list) | 13/13 pass, 0 skip, 0 fail | `homespace-phase5-core-pg-focused.log` |
| whole `RentalWorkflowPostgresTest` class (regression of everything touching the handover/committer) | 86/86 pass (73 existing + 13 new), 0 skip | `homespace-phase5-core-pg-full-class.log` |
| `hs-api-service` `test-compile` (HttpSystemTest and controller-test fixtures) | exit 0 (quiet run, empty log) | `homespace-phase5-core-api-testcompile.log` |

Unit cases: exactly four events, both enqueue methods MANDATORY; other party both directions; both-order and coincident-party dedupe; self-owned lease writes nothing; stranger actor, null actor, signing-child contract, missing party/id, null contract rejected with zero rows; strict envelope key set `eventId,eventType,version,occurredAt,recipients,data`, data keys exactly `contractId`, aggregate = contractId, topic, `sent_at` null; Java JSONL generator.

PostgreSQL cases (new, in `RentalWorkflowPostgresTest`; a `@BeforeEach` asserts the connected `current_database()` equals the database named by the already allowlisted URL, see "Review fix"): every PROPOSE notifies only the tenant, including replacing PROPOSED (clears the tenant confirmation), COMPLETED and DISPUTED; tenant-first and landlord-first confirmations with the opposite-party completion; denied (tenant propose, stranger confirm/dispute), stale and duplicate confirmation, missing acknowledgement, unknown action, future-dated invalid propose, GET, PDF prepare/list and a CLOSED lease all silent with the record unchanged; revision-0 dispute gives one notice with revision 2 (two saves), repeat dispute by either party stays DISPUTED, bumps the revision, reuses the complaint and is silent, a later PROPOSE then dispute notifies again; COMPLETED → DISPUTED notifies; rollback after the notice for propose, completing confirm and dispute leaves record, complaint count, outbox, deposit and contract unchanged and the same call then succeeds with one notice; SmartCA with nobody confirmed (PROPOSED, COMPLETED owner, COMPLETED tenant, no CONFIRMED, replays add nothing), with one human confirmation already present (CONFIRMED from the human, then COMPLETED to both), with both already confirmed (no new notice, revision unchanged), and a failure inside the signature transaction (record, `signedAt` and outbox roll back, the retry notifies once); concurrency: three simultaneous confirmations (two tenant, one owner) give one winner, revision 2 and exactly one CONFIRMED; two simultaneous completing confirmations and two simultaneous disputes give one winner each and the expected single COMPLETED / DISPUTED. The existing `parallelHandoverConfirmationCannotApplySameReviewedRevisionTwice` stays green inside the 86.

Not re-run (unchanged inputs): `InvoiceNotificationWriterTest`, `MonthlyInvoiceNotificationPostgresTest`, publisher FIFO/ACK/retry coverage (reused unchanged by design; the handover writer writes the same table and the publisher is topic/aggregate agnostic), `RentalWorkflowControllerTest` and `RentalWorkflowHttpSystemTest` (compile only).

Actual Java output for the consumer cross-check: `TEMP/homespace-handover-java-events.jsonl` — 5 lines from the real writer (PROPOSED, CONFIRMED, COMPLETED to landlord, COMPLETED to tenant, DISPUTED), generated by the writer unit test when `HS_HANDOVER_FIXTURE_OUT` is set.

Test-environment change worth review: `RentalWorkflowPostgresTest.DEDICATED_URL` was widened from `core_rental_notification_test_*` to `core_(rental_notification|notification_rollout)_test_*` so the class can run on the authorized rollout database. The previously gated 73 cases therefore ran for the first time here and passed; this widening is outside the Phase 5 minimum and can be reverted without affecting production code. The legacy `hs_workflow_test` gate is untouched.

### Review fix (root finding): database pin must not break supported test routes

Finding: the new `armHandoverWriter` `@BeforeEach` hard-coded `core_notification_rollout_test_33add50a2fa8` for every test of the class, so the other supported authorized configurations (`HS_WORKFLOW_TEST_PG_URL` legacy `hs_workflow_test`, and `HS_TEST_PG_URL` `core_rental_notification_test_*`) would always fail. Fix: new `static selectedDatabaseName()` returns the database name inside the URL that `databaseIsAllowed()` already validated (legacy URL when `legacyDatabase()`, otherwise `HS_TEST_PG_URL`), and the `@BeforeEach` asserts `current_database()` equals it. Create-drop safety is not loosened: `databaseIsAllowed()`, both allowlist regexes and the datasource selection are unchanged (the dedicated regex only gained the rollout name, see above), and no URL outside the three allowlisted shapes can run the class. All three routes therefore remain usable by design. Only the rollout route was executed: each rollout command first asserted the EXACT URL `jdbc:postgresql://localhost:5432/core_notification_rollout_test_33add50a2fa8` (and cleared `HS_WORKFLOW_TEST_PG_URL`); the legacy and `core_rental_notification_test_*` databases were NOT run (no authorization), so those two routes are supported by the static selection logic only, not by an execution.
Rerun of the 13 affected cases after the fix: 13/13 pass, 0 skip, exit 0 (`TEMP/homespace-phase5-core-pg-focused-rerun2.log`). The unchanged writer unit test, the 73 existing PG cases and the api test-compile were not rerun (their inputs did not change; the `@BeforeEach` only runs in this class and the 86/86 run before the fix used the same exact URL).


### Reported by other workers (not re-run by the Core owner)

- Consumer worker (message received via root, `ctx_accb316120e5`, follow-up `ctx_4ec546ba16eb`): 8 event suites / 394 tests pass, build, oxlint, diff check, isolated real Kafka/Mongo smoke including the four new types; full `tsc` only the same two pre-existing admin-broadcast spec errors; the actual 5-line Java JSONL above was parsed and rendered by the compiled dist for all four types (singleton recipients, unique eventIds, exact payload/metadata/routes, CONTRACT/NORMAL). Root read the consumer branch and reported alignment with the frozen contract.
- Web worker, first report (`ctx_b1a0be947161`, relayed by root): 18 new + 62 updated tests passed; scoped eslint and full `tsc` clean. One untouched test (rental-onboarding default) failed on a missing `useRentalRequestSync` mock; it is NOT established as pre-existing (no evidence was produced) and stays listed as an open limit. Root then found the review-gate new content hidden while editing and an own-action review race and sent a follow-up.
- Web worker, FINAL (`ctx_633db8165c6c`, as relayed by root): 20/20 focused tests + 44/44 rental-workflow/invoice tests passed, scoped eslint and full `tsc` clean, and mutation regressions were run for the fixes. Codex reviewed the fixes: the latest persisted proposal/evidence is visible while editing, and `acceptResult` is tied to the returned revision/status. No browser run and no real provider were used.

## Known limits and unverified risks

- Landlord-first CONFIRMED (R7 = notify) duplicates the PROPOSED notice within moments in the common case where the landlord proposes and immediately confirms; frozen by Codex.
- Re-propose/COMPLETED → PROPOSED/COMPLETED → DISPUTED business behaviour is existing; COMPLETED → DISPUTED flips the deposit read model back to `HANDOVER_PENDING`, so neutral copy must not claim the handover stays completed.
- Resolving or closing a HANDOVER complaint leaves the record DISPUTED with no workflow transition and no notice (complaint notifications excluded); the landlord must PROPOSE again, which notifies the tenant.
- The mode switch is trusted by code path only: `confirmFromVerifiedSignatures` is a public method (no REST route exposes it), and it still requires an existing transaction and the full lock/revision/eligibility checks.
- Rollback atomicity is proven by throwing after a real outbox insert (spy on the writer) and a real transaction rollback on PostgreSQL; a database-level failure of the insert itself was not simulated. A SmartCA-vs-human simultaneous race was not exercised (both serialize on the contract row lock, the same lock proven by the human races).
- Self-owned lease (same person as landlord and tenant): covered by unit tests only, not by PostgreSQL.
- Publisher ACK/FIFO/retry is only covered by the unchanged Phase 4 tests with a mocked `KafkaTemplate`; no real broker or SmartCA was used.
- In-flight PROPOSED records at deploy time notify only on their next transition (no backfill). Rolling Core out before the consumer or web would send unknown types to the DLT; keep the order consumer → web → Core. `notification.outbox.enabled=false` stops publishing and keeps rows.
- `occurredAt` uses `Instant.now()` like the invoice writer, not the injectable billing clock.
- The rental-onboarding default test failure (missing `useRentalRequestSync` mock) seen by the web worker on an untouched test is NOT established as pre-existing; no evidence either way.
- Web UI behaviour was verified by unit/logic tests only: no real browser session, push provider or SmartCA was exercised (browser/provider unverified).
- No production query was made; the whole rollout (Phase 6) is not complete.

## Phase 6 handoff (explicitly NOT implemented here)

- Lease activation: the landlord is never prompted to PROPOSE the handover when the lease becomes fully signed/ACTIVE (`SmartCaSignatureServiceImpl` activation path has no notification) — proposal: a Phase 6 "lease active, record the handover" notice to the landlord.
- All agreement signing turn/completion notices, including the move-in PDF (landlord signed → tenant's turn; PDF fully signed when the record is already COMPLETED, no state transition) belong to the shared Phase 6 signing family.
- Lease expiry/closure/termination freezing the handover record: silent here, Phase 6 owns them. The earlier concern that an applied amendment invalidates a PROPOSED handover was disproved in Phase 6B: the signed root `currentRevisionId` remains unchanged and `ContractTermsResolver` selects effective child snapshots. No handover state transition occurs solely from applying a supplement.
- Legacy generic `CONTRACT_AWAITING_SIGNATURE/SIGNED/EXPIRED` consumer types still have no Core producer.

## Final evidence summary (as accepted)

- Core (Core owner, serial, only the authorized rollout DB with its exact URL asserted): writer unit 7/7; 13 new PG cases 13/13; whole `RentalWorkflowPostgresTest` 86/86 (73 existing + 13 new, 0 skipped) before the review fix; after the `selectedDatabaseName()` fix the 13 affected cases were rerun 13/13 (0 skipped). `hs-api-service` test-compile exit 0. Legacy `hs_workflow_test` and `core_rental_notification_test_*` databases were not run.
- Consumer (their report): 8 event suites / 394 tests, build, oxlint, diff check, isolated real Kafka/Mongo smoke including the four new types, and the actual 5-line Java JSONL crosscheck (compiled dist parse/render) passed; `tsc` only the two pre-existing untouched admin-broadcast spec errors.
- Web (final worker report): 20/20 focused + 44/44 rental-workflow/invoice tests, scoped eslint, full `tsc` clean, mutation regressions.

## Phase 6 staging (recorded at acceptance; nothing implemented)

Phase 6 is split into sequential stages to avoid one oversized contract change; each stage is audited, frozen by Codex, implemented and accepted in order:
- **6A** — sending, review, signing turn, verified signatures and activation (the shared agreement families). Inherits the Phase 5 handoff items: lease activation prompting the landlord to propose the handover, all agreement signing turn/completion notices including the move-in PDF, and the dormant legacy `CONTRACT_AWAITING_SIGNATURE/SIGNED/EXPIRED` types.
- **6B** — amendments (including a pending handover proposal invalidated by an applied amendment).
- **6C** — renewals.
- **6D** — termination.
- **6E** — return and final settlement.

Next: audits only for 6A are starting; no Phase 6 implementation has begun.

## Acceptance record

Accepted locally by Codex (root) on 2026-11-14, with the limits above preserved. No commit, push or deploy was performed.
