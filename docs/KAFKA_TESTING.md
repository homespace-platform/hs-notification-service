# Kafka notification ingestion v1

Enable `KAFKA_ENABLED=true` only with all Kafka environment values supplied: `KAFKA_BROKERS` (comma separated hosts), `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`, `KAFKA_EVENTS_TOPIC`, `KAFKA_DLT_TOPIC`, `KAFKA_RETRY_ATTEMPTS` (integer 1..10), `KAFKA_RETRY_DELAY_MS` (integer 0..10000). Use different source/DLT topics. Provision topics before startup; auto creation is disabled. Restrict source produce permissions to trusted business services and test operators. The consumer trusts producer recipient selection; never expose a public HTTP notification creation endpoint.

The exact v1 envelope contains `eventId`, `eventType`, `version: 1`, `occurredAt` (UTC ISO with milliseconds), `recipients` (1..100 unique Keycloak user IDs), and `data`. IDs accept ASCII letters/digits followed by letters/digits/underscore/hyphen, maximum 200 characters. Unknown properties are rejected. Each event ID must be globally unique and immutable: reusing it for the same recipient keeps the existing notification. Recipients come from authorized business producers, with no Core API lookup.

| Event types                                                    | Required data                  | Category    |
| -------------------------------------------------------------- | ------------------------------ | ----------- |
| LISTING_APPROVED, LISTING_REJECTED, LISTING_CREATED, LISTING_UPDATED, LISTING_EXPIRED | listingId; optional listingTitle | LISTING |
| LISTING_EDIT_APPROVED, LISTING_EDIT_REJECTED                   | listingId, editId; optional listingTitle | LISTING |
| LISTING_STATUS_CHANGED                                         | listingId, status (`PENDING_REVIEW`, `HIDDEN`, `VIOLATION`, `RENTED_EXTERNALLY`); optional listingTitle | LISTING |
| BOOKING_REQUESTED, BOOKING_CONFIRMED, BOOKING_CANCELLED, BOOKING_REJECTED | bookingId; optional recipientSide | APPOINTMENT |
| BOOKING_RESCHEDULE_REQUESTED, BOOKING_RESCHEDULE_APPROVED, BOOKING_RESCHEDULE_REJECTED | bookingId; optional recipientSide | APPOINTMENT |
| BOOKING_COMPLETED, BOOKING_EXPIRED | bookingId; optional recipientSide | APPOINTMENT |
| CONTRACT_AWAITING_SIGNATURE, CONTRACT_SIGNED, CONTRACT_EXPIRED | contractId                     | CONTRACT    |
| PAYMENT_SUCCESSFUL, PAYMENT_FAILED, PAYMENT_OVERDUE            | paymentId                      | PAYMENT     |
| CHAT_MESSAGE_RECEIVED                                          | conversationId                 | CHAT        |
| PLATFORM_ANNOUNCEMENT                                          | title (1..200), body (1..2000) | SYSTEM      |
| ACCOUNT_ROLE_CHANGED, ACCOUNT_DISABLED, ACCOUNT_ENABLED        | none: `data` must be exactly `{}` | ACCOUNT  |
| MEMBERSHIP_ACTIVATED, MEMBERSHIP_PAYMENT_REVIEW                | orderId (only key)             | PAYMENT     |
| PAYMENT_REQUEST_CREATED, PAYMENT_TRANSFER_REPORTED, PAYMENT_RECEIPT_CONFIRMED, PAYMENT_RECEIPT_REJECTED, PAYMENT_DISPUTE_OPENED, PAYMENT_DISPUTE_EVIDENCE_ADDED, PAYMENT_DISPUTE_PROPOSED, PAYMENT_DISPUTE_PROPOSAL_DECLINED, PAYMENT_DISPUTE_ESCALATED, PAYMENT_DISPUTE_REVIEW_TRANSFER, PAYMENT_DISPUTE_REOPENED | paymentId (only key), exactly one recipient | PAYMENT |
| INVOICE_DRAFT_READY, INVOICE_ISSUED, INVOICE_OVERDUE, INVOICE_AMOUNT_UPDATED, INVOICE_EXTENSION_REQUESTED, INVOICE_EXTENSION_APPROVED, INVOICE_EXTENSION_REJECTED, INVOICE_EXTENSION_EXPIRED, INVOICE_OVERDUE_ACTION_RECORDED, INVOICE_OVERDUE_ACTION_ACKNOWLEDGED, INVOICE_DEFERRED, INVOICE_ROLLED_OVER, INVOICE_OVERDUE_ACTION_REQUIRED | contractId, invoiceId (only keys), exactly one recipient | PAYMENT |
| MOVE_IN_HANDOVER_PROPOSED, MOVE_IN_HANDOVER_CONFIRMED, MOVE_IN_HANDOVER_COMPLETED, MOVE_IN_HANDOVER_DISPUTED, MOVE_IN_HANDOVER_READY | contractId (only key), exactly one recipient | CONTRACT |
| AGREEMENT_REVIEW_READY, AGREEMENT_SIGNING_TURN, AGREEMENT_FULLY_SIGNED, AGREEMENT_SIGNATURE_NEEDS_REVIEW | agreementId + agreementKind (only keys), exactly one recipient | CONTRACT |
| AMENDMENT_RESPONSE_NEEDED, AMENDMENT_DECIDED, AMENDMENT_WITHDRAWN, AMENDMENT_EXPIRED, AMENDMENT_APPLIED | contractId (only key), exactly one recipient | CONTRACT |
| RENEWAL_REQUESTED, RENEWAL_APPROVED, RENEWAL_REJECTED, RENEWAL_EXPIRED | contractId (only key), exactly one recipient | CONTRACT |
| TERMINATION_RESPONSE_NEEDED, TERMINATION_AGREED, TERMINATION_DECLINED, TERMINATION_WITHDRAWN, TERMINATION_NOTICE_ISSUED, TERMINATION_REVIEW_REQUESTED, TERMINATION_REVIEW_APPROVED, TERMINATION_NOTICE_CANCELLED, TERMINATION_ENDED, LEASE_EXPIRED | contractId (only key), exactly one recipient | CONTRACT |
| LEASE_RETURN_CONFIRMED, LEASE_RETURN_COMPLETED | contractId (only key), exactly one recipient | CONTRACT |
| SETTLEMENT_RESPONSE_NEEDED, SETTLEMENT_DISPUTED, SETTLEMENT_PROPOSAL_INVALIDATED, SETTLEMENT_AGREED, SETTLEMENT_RESPONSE_OVERDUE, SETTLEMENT_PAYMENT_OVERDUE, LEASE_CLOSED | contractId (only key), exactly one recipient | CONTRACT |
| PAYMENT_OBLIGATION_OVERDUE | paymentId (only key), exactly one recipient | PAYMENT |

Resource events use fixed templates. Booking `data.recipientSide` accepts only `OWNER` or `RENTER`: OWNER opens `/dashboard/viewing-schedules?appointmentId=<bookingId>`, RENTER opens `/dashboard/viewing-schedules/my-bookings?appointmentId=<bookingId>`. Booking events may also include `listingTitle` (plain text, 1–120 characters), `appointmentDate` (`YYYY-MM-DD`) and `startTime` (`HH:mm`) so the notification body identifies the listing and viewing time. `BOOKING_RESCHEDULE_REQUESTED` uses the proposed date/time; other booking events use the current date/time. Date and time appear together when both are present. The service constructs routes and content from these validated fields; producer URLs and other data fields are rejected. Legacy booking data containing only `bookingId` remains accepted and opens `/notifications`, as do other non-listing resource types. `bookingId` and the optional side remain in metadata. If a system event targets both sides, publish separate envelopes with the correct side and recipients. A cancellation event alone cannot determine which side receives it.

## Listing events

All listing events are category `LISTING`, priority `NORMAL`, v1 envelope unchanged. `data` accepts only the keys in the table above (no others, no producer URLs, reasons or private content). `listingId` and `editId` are identifiers; `listingTitle` is plain text, 1–120 characters (no `<`, `>` or control characters) and is appended to the in-app body as `Tin: <title>.`. `LISTING_APPROVED`/`LISTING_REJECTED` keep accepting the legacy `{listingId}` payload. Every listing event opens `/dashboard/properties/view?id=<encodeURIComponent(listingId)>`; metadata holds `listingId` plus `editId` or `status` when present (never the title). Titles/bodies are fixed server-owned Vietnamese templates; `LISTING_STATUS_CHANGED` uses status-specific copy.

| Producer action (hs-core-api)                       | Event                    |
| --------------------------------------------------- | ------------------------ |
| Admin creates a listing                             | LISTING_CREATED          |
| Admin saves a listing directly                      | LISTING_UPDATED          |
| Admin publication decision                          | LISTING_APPROVED / LISTING_REJECTED |
| Admin edit decision                                 | LISTING_EDIT_APPROVED / LISTING_EDIT_REJECTED |
| Admin manual expiry, scheduler actual expiry        | LISTING_EXPIRED          |
| Admin sets pending review, hidden, violation, rented externally | LISTING_STATUS_CHANGED |

Edit approval does not imply the listing is published, and edit rejection does not imply the whole listing was rejected. Expiry means the publication window ended, including while an edit is under review. Owner self-actions and generic rental/contract state changes do not publish listing events.

**Rollout order:** deploy and verify this consumer before `hs-core-api` publishes the new types or the optional `listingTitle`. Older strict consumers send unknown types and fields to the DLT. Use `listingId` as the Kafka key and a new immutable event ID per transition.

Announcements accept plain text only (no HTML/control characters), with no producer URLs. All priorities are NORMAL, including scheduler booking events. Private chat text, financial details and rejection reasons are deliberately absent. Publish each transition with a new immutable event ID (not the booking ID reused across its lifecycle), use the booking ID as Kafka key, and serialize `occurredAt` with exactly three UTC millisecond digits.

## Rental request events

All rental events are category `RENTAL_REQUEST`, priority `NORMAL`, v1 envelope unchanged. `data` accepts exactly `requestId` (identifier, required), `recipientSide` (`OWNER` or `RENTER`, **required**, unlike legacy booking) and optional `listingTitle` (plain text, 1–120 characters). Any other key (status, changeId, rentalRequestId, flow, deadline, notes, reasons, names, address, amount, URL…) is rejected and goes to the DLT. There is no legacy payload shape for these types.

Exact 26 types: `RENTAL_REQUEST_SUBMITTED`, `RENTAL_REQUEST_ACCEPTED`, `RENTAL_REQUEST_REJECTED`, `RENTAL_REQUEST_AUTO_REJECTED`, `RENTAL_REQUEST_CANCELLED`, `RENTAL_REQUEST_EXPIRED`, `RENTAL_HOLD_EXPIRED`, `RENTAL_CANCELLATION_REQUESTED`, `RENTAL_CANCELLATION_REFUND_PENDING`, `RENTAL_CANCELLATION_REJECTED`, `RENTAL_CANCELLATION_WITHDRAWN`, `RENTAL_CANCELLATION_DISPUTED`, `RENTAL_START_CHANGE_REQUESTED`, `RENTAL_START_CHANGE_APPROVED`, `RENTAL_START_CHANGE_REJECTED`, `RENTAL_START_CHANGE_WITHDRAWN`, `RENTAL_START_CHANGE_EXPIRED`, `RENTAL_SIGNING_WINDOW_REOPENED`, `RENTAL_HOLD_EXTENDED`, `RENTAL_DEFAULT_NOTICE_ISSUED`, `RENTAL_DEFAULT_DISPUTED`, `RENTAL_REQUEST_CANCELLED_BY_SYSTEM`, `RENTAL_RESUME_REQUESTED`, `RENTAL_RESUMED`, `RENTAL_RESUME_REJECTED`, `RENTAL_RESUME_WITHDRAWN`.

Routes are fixed by the service (no producer path): OWNER opens `/dashboard/rental-requests?requestId=<encodeURIComponent(requestId)>`, RENTER opens `/dashboard/rental-requests/my-requests?requestId=<encodeURIComponent(requestId)>`. Metadata is exactly `{requestId, recipientSide}` (never the title). Each side gets a separate envelope with its own immutable event ID, recipients taken from the persisted Core parties. Copy is fixed, neutral Vietnamese per type: `RENTAL_CANCELLATION_REFUND_PENDING` states the cancellation/refund is not complete, `RENTAL_REQUEST_AUTO_REJECTED` says another request was chosen, request expiry (`RENTAL_REQUEST_EXPIRED`) and hold expiry (`RENTAL_HOLD_EXPIRED`) are separate, default notices only ask the user to review the current deadline (kind and details are not in the payload), `RENTAL_SIGNING_WINDOW_REOPENED`/`RENTAL_RESUMED` do not mean a contract is signed, and `RENTAL_CANCELLATION_DISPUTED` is not an admin complaint resolution. `listingTitle` is appended to the in-app body only as `Tin: <title>.`; push stays generic.

Preferences: `RENTAL_REQUEST` is added to the category tuple (now 8 categories). Existing stored preference documents without it default to enabled for push and email through `withDefaults`; the in-app notification is always persisted. An older web client that saves preferences with only the previous 7 categories may reset `RENTAL_REQUEST` to the default (enabled). No migration, no new socket events and no push changes. The web client must handle the new category label.

Scope: pre-tenancy rental request decisions only. Actual contract activation and payment-only events are deferred.

**Rollout order:** consumer (this service) → web → producer (`hs-core-api`). An older strict consumer treats the new types as unknown, sends them to the DLT and commits the offset, so the producer must not publish before this consumer is deployed and verified.

## Account events

Events: `ACCOUNT_ROLE_CHANGED`, `ACCOUNT_DISABLED`, `ACCOUNT_ENABLED`. Category `ACCOUNT`, priority `NORMAL`, v1 envelope unchanged. Existing category, preferences and storage schema are unchanged.

- `recipients` must contain **exactly one** entry: the affected account's Keycloak subject. Never the admin actor, and never a fan-out.
- `data` must be exactly `{}`. Any key (role, previous role, permissions, email, name, actor, reason, status, account ID, URL, path…) is rejected and goes to the DLT. There is no ID or sentinel field; the recipient and `eventId` identify the transition.
- The notification has no metadata. The route is fixed by the service: `/settings/account-security` (own account, no query string, no producer path).
- Copy is fixed and generic Vietnamese. It names no role, permission, reason or actor. `ACCOUNT_ROLE_CHANGED` only says access changed and asks the user to check the current account information. Roles are owned by Core and may not yet be reflected in the user's Keycloak token, so the copy never claims they are synced. Push stays the generic signal.
- Use a new immutable `eventId` per transition and the account ID as Kafka key. Never derive the ID from user and type alone: disable → enable → disable would dedupe the second disable. Reusing an ID for the same recipient keeps the first notification.
- Do not publish no-op transitions (role or status unchanged).

Delivery limits: the notification is always persisted for the recipient, but this service never checks account status. A disabled account cannot authenticate, so it can read the record only after re-enable and sign-in. Realtime reaches only a socket whose token is still valid, and a generic push may or may not be shown; neither is guaranteed. The producer must not assume the user saw `ACCOUNT_DISABLED`. The Core change and the Keycloak change are separate systems: there is no distributed transaction across Core, Keycloak and Kafka, so publish only after the Core change is durably committed (outbox) and expect at-least-once delivery.

**Rollout order:** consumer (this service) → web → producer (`hs-core-api`). An older strict consumer treats these types as unknown, sends them to the DLT and commits the offset, so events published early are lost unless an operator republishes the retained source record with the same `eventId`. Enable the producer only after every consumer replica runs this version.

## Membership events

Events: `MEMBERSHIP_ACTIVATED`, `MEMBERSHIP_PAYMENT_REVIEW`. Category `PAYMENT` (existing), priority `NORMAL`, v1 envelope unchanged. Preferences, schema, topics and config are unchanged. The existing `PAYMENT_SUCCESSFUL`/`PAYMENT_FAILED`/`PAYMENT_OVERDUE` types keep their `paymentId` contract and must not be used for membership orders.

- `recipients` must contain **exactly one** entry: the order owner's Keycloak subject.
- `data` must be exactly `{ "orderId": "<id>" }` (the standard identifier rule; the existing 32-hex order IDs fit). Any other key (tier, amount, provider, status, transaction number or hash, payment ID, reason, timestamps, URL, path, names…) is rejected and goes to the DLT.
- Metadata is exactly `{orderId}`. The route is fixed by the service: `/dashboard/membership/return?orderId=<encodeURIComponent(orderId)>`. That page loads the owner-checked order status from Core, so the notification never states or implies a payment result by itself.
- Producer rules: publish `MEMBERSHIP_ACTIVATED` only when the order status actually transitions to `PAID` (activation succeeded), and `MEMBERSHIP_PAYMENT_REVIEW` only on an actual transition to `REVIEW`, in the same transaction as the status write (outbox). Never publish from a callback, return URL, transaction submission, replay with no status change, or because `paidAt` is set (it is also set for `REVIEW`). `FAILED`, `EXPIRED` and `CANCELLED` have no event.
- Copy is fixed Vietnamese. The review text is deliberately neutral ("Giao dịch của đơn gói đăng tin cần được đối soát. Vui lòng mở đơn hàng để kiểm tra trạng thái hiện tại.") because a second transaction can move an already `PAID` order to `REVIEW`; it never says the plan was not or never activated, and it carries no amount, provider, hash or error.
- Use a new immutable `eventId` per transition and `orderId` as Kafka key. `PAID` then `REVIEW` are separate transitions and persist as two notifications. Reusing an ID for the same recipient keeps the first notification.

**Rollout order:** consumer (this service) → web → producer (`hs-core-api`). An older strict consumer treats these types as unknown, sends them to the DLT and commits the offset, so the producer must not publish before every consumer replica runs this version; lost events can be recovered only by republishing the retained source record with the same `eventId`.

## Payment and refund events

Eleven new types, one table row above. Category `PAYMENT` (existing), priority `NORMAL`, v1 envelope unchanged. Preferences, schema, topics and config are unchanged. They are distinct from the legacy `PAYMENT_SUCCESSFUL`/`PAYMENT_FAILED`/`PAYMENT_OVERDUE` types, whose `{paymentId}` schema, existing recipient cardinality and `/notifications` route are unchanged, and from the membership `orderId` events and route. The consumer branches on the new event name, never on the `paymentId` key alone.

- `recipients` must contain **exactly one** entry: the persisted payer or payee the notice is for. Refunds reverse the usual landlord/tenant direction, so the producer picks the recipient from the stored payer/payee, never from a role label.
- `data` must be exactly `{ "paymentId": "<id>" }`. The standard identifier rule is kept (Core payment IDs are 36-character UUIDs and fit; it is URL-safe, and the route still applies `encodeURIComponent`). It is not tightened to UUID-only so that no previously valid identifier form is newly sent to the DLT. Any other key (amount, bank details, reason, file, names, recipient role, status, URL, path…) is rejected and goes to the DLT.
- Metadata is exactly `{paymentId}`. The route is fixed by the service: `/dashboard/payments?paymentId=<encodeURIComponent(paymentId)>`. The web page resolves the payment from the viewer's own authorized payment list, so the notification never states or implies a payment result by itself.
- Copy is fixed Vietnamese and neutral to payer/payee. It carries no amount, bank detail, name, reason, file or deadline. Wording distinguishes: a reported transfer (`PAYMENT_TRANSFER_REPORTED`, "not yet confirmed received") from a confirmed receipt (`PAYMENT_RECEIPT_CONFIRMED`); a receipt rejection (`PAYMENT_RECEIPT_REJECTED`, the receiver declined to confirm) from a generic failure; and a dispute routed back to review (`PAYMENT_DISPUTE_REVIEW_TRANSFER`, "not a received-money confirmation") from a reopened transfer report (`PAYMENT_DISPUTE_REOPENED`). `PAYMENT_REQUEST_CREATED` does not say the payment is payable now or how much time remains, because a delayed first rent can already be overdue when created. Push stays the generic signal.

| Event | Producer trigger (hs-core-api) | Recipient |
| ----- | ------------------------------ | --------- |
| PAYMENT_REQUEST_CREATED | positive delayed first-rent `INITIAL` row or Phase 6E obligation below actually inserted; waiver, zero amount or replay is silent | stored payer |
| PAYMENT_TRANSFER_REPORTED | valid report (web or mobile upload) changes the payment to `TRANSFER_REPORTED` | stored payee |
| PAYMENT_RECEIPT_CONFIRMED | valid payee confirmation changes the payment to `CONFIRMED` | stored payer |
| PAYMENT_RECEIPT_REJECTED | valid payee rejection changes the payment to `REJECTED` | stored payer |
| PAYMENT_DISPUTE_OPENED | valid party dispute changes the payment to `DISPUTED` | other stored party |
| PAYMENT_DISPUTE_EVIDENCE_ADDED | a comment attaches a genuinely new evidence object | other stored party |
| PAYMENT_DISPUTE_PROPOSED | valid new route proposal | other stored party |
| PAYMENT_DISPUTE_PROPOSAL_DECLINED | valid decline clears the proposal | proposer |
| PAYMENT_DISPUTE_ESCALATED | valid escalation changes the case state | other stored party |
| PAYMENT_DISPUTE_REVIEW_TRANSFER | accepted or admin-decided route returns the payment to review; confirms no money | other party; an admin decision reaches both (two envelopes) |
| PAYMENT_DISPUTE_REOPENED | accepted or admin-decided route reopens the transfer; suppressed where `RENTAL_HOLD_EXTENDED` already reaches the same recipients | other party; an admin decision reaches both (two envelopes) |

- Producer rules: publish from the same transaction as the state change (outbox). Denied, no-op, replayed and rolled-back actions publish nothing. Never accept a trusted event from a client request body or return page. A reported transfer can produce PAYMENT_TRANSFER_REPORTED, but cannot produce PAYMENT_RECEIPT_CONFIRMED.
- Use a new immutable `eventId` per transition and `paymentId` as the Kafka key so one payment's events stay ordered within a partition. Reusing an ID for the same recipient keeps the first notification. A two-party outcome is two envelopes, one recipient each.
- Monthly invoice events use the separate family below. Phase 6E reuses `PAYMENT_REQUEST_CREATED` for settlement/adjustment/agreed-refund creation; common report/receipt/dispute events remain unchanged for every payment type.

**Rollout order:** consumer (this service) → web → producer (`hs-core-api`). An older strict consumer treats these types as unknown, sends them to the DLT and commits the offset, so the producer must not publish before every consumer replica runs this version; lost events can be recovered only by republishing the retained source record with the same `eventId`.

## Monthly invoice events

Thirteen types (table row above). Category `PAYMENT` (existing), priority `NORMAL`, v1 envelope unchanged. Preferences, schema, topics and config are unchanged. They are separate from the legacy `PAYMENT_*` types, Phase 3 payment/refund types and membership `orderId` types; the consumer branches on the exact event name, never on key shape.

- `recipients` must contain **exactly one** entry: the persisted landlord or tenant the notice is for. A two-party outcome is two envelopes with distinct immutable `eventId`s.
- `data` must be exactly `{ "contractId": "<id>", "invoiceId": "<id>" }`, both under the standard identifier rule (Core ids are 36-character UUIDs and fit). That rule also rejects the synthetic `first-rent:<paymentId>` ids, so a first-rent row can never produce an invoice notice. Any other key (amount, late fee, due date, meter value, reason, note, name, status, payment id, side, URL, path…) is rejected and goes to the DLT.
- Metadata is exactly `{contractId, invoiceId}`. The route is fixed by the service: `/dashboard/invoices/<encodeURIComponent(contractId)>?section=monthly&invoice=<encodeURIComponent(invoiceId)>`. The page loads the invoice with the viewer's own authorization, so a notice never states or implies the current status, a payable window or a lease outcome.
- Copy is static Vietnamese: no amount, date, meter, reason, note or name; push stays the generic signal. Every body sends the viewer to the current invoice, because the invoice can change after the event.

| Event | Meaning of the copy | Recipient |
| ----- | ------------------- | --------- |
| INVOICE_DRAFT_READY | a new monthly invoice exists; inspect its current content and status | landlord |
| INVOICE_ISSUED | the invoice was issued; see its current status (a catch-up issue may already be past due) | tenant |
| INVOICE_OVERDUE | the invoice is overdue; see the current options (not a lease termination) | both parties, one envelope each |
| INVOICE_AMOUNT_UPDATED | the invoice amount changed; inspect before transferring | tenant |
| INVOICE_EXTENSION_REQUESTED | an extension request is pending | landlord |
| INVOICE_EXTENSION_APPROVED / _REJECTED / _EXPIRED | the actual outcome of the extension request; no days, deadline or automatic acceptance | tenant |
| INVOICE_OVERDUE_ACTION_RECORDED | the landlord recorded a step (not an ended lease or an accepted proposal) | tenant |
| INVOICE_OVERDUE_ACTION_ACKNOWLEDGED | the tenant viewed or responded (never agreement) | landlord |
| INVOICE_DEFERRED | a decision to carry the debt into the next invoice (not an actual rollover, payment or QR cancellation) | tenant; automatic decision: both |
| INVOICE_ROLLED_OVER | the old debt actually moved into another invoice and the old payment request was cancelled (not forgiven or paid); aggregate = old invoice | tenant |
| INVOICE_OVERDUE_ACTION_REQUIRED | the landlord should inspect the overdue invoice and its options | landlord |

Use a new immutable `eventId` per distinct outcome and recipient, and `invoiceId` as the Kafka key. Publish from the same transaction as the state change (outbox); no-op, replayed or rolled-back actions publish nothing. Termination types are not part of this contract.

**Rollout order:** consumer (this service) → web → producer (`hs-core-api`). An older strict consumer treats the new types as unknown, sends them to the DLT and commits the offset, so the producer must not publish before every consumer replica runs this version; lost events can be recovered only by republishing the retained source record with the same `eventId`.

## Move-in handover events

Five types: `MOVE_IN_HANDOVER_PROPOSED`, `MOVE_IN_HANDOVER_CONFIRMED`, `MOVE_IN_HANDOVER_COMPLETED`, `MOVE_IN_HANDOVER_DISPUTED`, `MOVE_IN_HANDOVER_READY` (Phase 6A). Category `CONTRACT` (existing), priority `NORMAL`, v1 envelope unchanged. Preferences, schema, topics and config are unchanged. Separate from the legacy `CONTRACT_*` types and from invoice types; the consumer branches on the exact event name.

- `recipients` must contain **exactly one** entry (a persisted party chosen by Core; the consumer never invents recipients or state). A two-party outcome is two envelopes with distinct immutable `eventId`s.
- `data` must be exactly `{ "contractId": "<root lease id>" }` under the standard identifier rule. Any other key (invoice/handover id, revision, role, amount, note, reason, actor, side, URL, path…) is rejected and goes to the DLT.
- Metadata is exactly `{contractId}`. The route is fixed by the service: `/dashboard/invoices/<encodeURIComponent(contractId)>?section=deposit&workflow=move-in`. The page loads the current record with the viewer's own authorization.
- Copy is static Vietnamese and refers to the current record, never to private or free text: PROPOSED = record created or updated; CONFIRMED = one party confirmed (open to see current state, not a promise it is still awaiting anyone); COMPLETED = both parties confirmed (not money received); DISPUTED = a party reported a problem with the record (not a complaint resolution). Push stays the generic signal.
- Core triggers (for reference, not enforced here): CONFIRMED is the first human confirmation in either direction; a human completing only the other party's confirmation, or a trusted SmartCA signature, emits COMPLETED with no intermediate event; a repeated dispute is silent.
- `MOVE_IN_HANDOVER_READY` (Phase 6A, Core sends to the landlord only): the signed lease is available and the landlord can inspect or record the handover. Same data, metadata and route as above. Copy does not claim a handover record or proposal exists.

Use `contractId` as the Kafka key and a new immutable `eventId` per distinct outcome and recipient. Publish from the same transaction as the state change (outbox); no-op, replayed or rolled-back actions publish nothing.

**Rollout order:** consumer (this service) → web → producer (`hs-core-api`). An older strict consumer treats the new types as unknown, sends them to the DLT and commits the offset, so the producer must not publish before every consumer replica runs this version; lost events can be recovered only by republishing the retained source record with the same `eventId`.

## Agreement signing events (Phase 6A)

Four types: `AGREEMENT_REVIEW_READY`, `AGREEMENT_SIGNING_TURN`, `AGREEMENT_FULLY_SIGNED`, `AGREEMENT_SIGNATURE_NEEDS_REVIEW`. Category `CONTRACT`, priority `NORMAL`, v1 envelope unchanged; separate from legacy `CONTRACT_*` and the handover family. No schema, preference, topic or config change.

- `recipients` must contain **exactly one** entry; Core owns triggers and recipients. A two-party outcome is two envelopes with distinct `eventId`s.
- `data` must be exactly `{ "agreementId", "agreementKind" }`; `agreementId` follows the standard identifier rule and is the exact signing-envelope id (the root id only for the root lease/deposit). Any other key (role, revision, amount, reason, failure code, date, PDF/URL, actor…) is rejected and goes to the DLT.
- All four types accept the same closed `agreementKind` enum: `LEASE | DEPOSIT | AMENDMENT | RENEWAL | MOVE_IN | EARLY_EXIT`. `AGREEMENT_REVIEW_READY` includes AMENDMENT (Phase 6B), RENEWAL (Phase 6C) and EARLY_EXIT (Phase 6D) signing children; unknown kinds are rejected. The exact child signing identity stays separate from root decision events.
- Metadata is exactly `{agreementId, agreementKind}`. Route: `/dashboard/contracts/<encodeURIComponent(agreementId)>`, plus `?workflow=move-in` only for `MOVE_IN`.
- Copy is static, kind-neutral Vietnamese and always points to the current status: REVIEW_READY = a document was created and may need review (not a ready-PDF or signable guarantee); SIGNING_TURN = the other party completed their part (no digital-signature-verified claim, it also covers internal signing); FULLY_SIGNED = required signatures verified complete, not a claim that terms were applied; SIGNATURE_NEEDS_REVIEW = an async signature request could not complete and needs checking, open the status or contact support (no valid/invalid-signature assertion, no retry or block promise).

Use `agreementId` as the Kafka key and a new immutable `eventId` per distinct outcome and recipient; publish from the same transaction as the state change.

**Rollout order:** consumer (this service) → web → producer (`hs-core-api`). An older strict consumer sends the new types (and `MOVE_IN_HANDOVER_READY`) to the DLT and commits the offset, so Core must not publish before every consumer replica runs this version.

**Smoke:** `npm run test:backend` (real Kafka + MongoDB, database `homespace_notification_test`, topics `homespace.notification.test.*`, push and socket off, no cleanup) covers the four agreement types across LEASE, DEPOSIT, AMENDMENT, RENEWAL, MOVE_IN and EARLY_EXIT, rejects unknown kinds, and covers `MOVE_IN_HANDOVER_READY`.

## Amendment decision events (Phase 6B)

Five types: `AMENDMENT_RESPONSE_NEEDED`, `AMENDMENT_DECIDED`, `AMENDMENT_WITHDRAWN`, `AMENDMENT_EXPIRED`, `AMENDMENT_APPLIED`. Each v1 envelope has exactly one recipient and data exactly `{ "contractId": "<root lease id>" }`; any extra key or multi-recipient payload is rejected to the redacted DLT. Category `CONTRACT`, priority `NORMAL`, metadata exactly `{contractId}`, fixed route `/dashboard/contracts/<encodeURIComponent(contractId)>`. Copy gives the decision category without private reasons, terms, dates, money or unsupported payment claims. Core writes one envelope per persisted party from the same transaction as the transition, using the root id as Kafka/outbox key. The approved child signing document uses `AGREEMENT_REVIEW_READY` with `agreementKind=AMENDMENT`; verified signatures use the existing 6A signing events. The real Kafka/Mongo smoke now checks five amendment types, replay dedupe, exact route/metadata and recipient isolation.

## Renewal and termination events (Phases 6C–6D)

Four `RENEWAL_*` and ten termination/lease-expiry types use one persisted root party per envelope, data exactly `{contractId}`, category `CONTRACT`, priority `NORMAL`, metadata exactly `{contractId}`, and fixed `/dashboard/contracts/<encoded contractId>`. The consumer rejects extra/private data and fanout. Core's root outbox is transactional and keyed by the contract id; replay is idempotent by immutable event id. See `checklist/RENEWAL_NOTIFICATIONS.md` and `checklist/TERMINATION_NOTIFICATIONS.md` for the exact transition matrix. An EARLY_EXIT signing PDF uses the same four `AGREEMENT_*` types with `agreementKind=EARLY_EXIT` and exact child `agreementId`; it must not be confused with root termination state. The real Kafka/Mongo smoke covers all these types, replay, route, metadata and isolation.

Termination copy distinguishes a proposal, agreement, unilateral notice, review outcome and actual lease end. Agreement does not confirm return or settlement; `TERMINATION_ENDED` and `LEASE_EXPIRED` direct the viewer to check return, debt and settlement separately. Copy carries no reason, amount or date; push stays generic. Return and final-settlement events use the separate Phase 6E family below.

**Rollout order:** consumer (every replica, including the EARLY_EXIT kind extension) → web → producer (`hs-core-api`). Older strict consumers quarantine unknown types or kinds to the redacted DLT and commit the offset; recovery requires republishing the retained source record with the same immutable `eventId` after upgrading.

## Return, deposit settlement and obligation deadlines (Phase 6E)

Nine new root types use the unchanged v1 envelope, exactly one persisted recipient, data exactly `{contractId}`, metadata exactly `{contractId}`, category `CONTRACT` and priority `NORMAL`. `LEASE_RETURN_CONFIRMED` and `LEASE_RETURN_COMPLETED` open `/dashboard/contracts/<encodeURIComponent(contractId)>`, including for a terminated lease. The seven settlement types open `/dashboard/invoices/<encodeURIComponent(contractId)>?section=deposit` to show the current authorized settlement record.

| Type | Copy meaning / producer boundary |
| --- | --- |
| LEASE_RETURN_CONFIRMED | One party recorded return confirmation; not bilateral possession or financial completion. |
| LEASE_RETURN_COMPLETED | Return was recorded; also valid for unilateral landlord recording, so never claims both parties agreed. Legacy complete/force remains consolidated into `TERMINATION_ENDED`. |
| SETTLEMENT_RESPONSE_NEEDED | Ordinary proposal or changed proposal version needs review. Complaint-sourced proposal/admin progress is excluded. |
| SETTLEMENT_DISPUTED | Settlement proposal is not agreed and needs reconciliation; not a complaint outcome. |
| SETTLEMENT_PROPOSAL_INVALIDATED | A new final-cost supplement invalidated a pending proposal. Existing `INVOICE_ISSUED` describes the separate financial consequence; unchanged/replayed supplements are silent. |
| SETTLEMENT_AGREED | Tenant accepted a balance-payment settlement; transfer and confirmed receipt remain separate. For a deposit refund the owner's `PAYMENT_REQUEST_CREATED` is the acceptance cue instead. |
| SETTLEMENT_RESPONSE_OVERDUE | The current response window passed; inspect/reconcile, never automatic consent. Ordinary PROPOSED reaches tenant, DISPUTED reaches landlord. |
| SETTLEMENT_PAYMENT_OVERDUE | Closure refund/balance deadline needs reconciliation, including when transfer is already reported or disputed; never asserts an absent transfer. |
| LEASE_CLOSED | The deposit-settlement record closed, including with no transfer. Never claims all independent rent refunds/debts were paid. |

`PAYMENT_OBLIGATION_OVERDUE` joins the strict routed payment family: exactly one stored payer recipient, data and metadata exactly `{paymentId}`, `PAYMENT`/`NORMAL`, fixed `/dashboard/payments?paymentId=<encodeURIComponent(paymentId)>`. It describes the first actual overdue transition of an amendment deposit delta or agreed early-exit rent refund; it is separate from the legacy `PAYMENT_OVERDUE` contract and route. Copy only asks the user to reconcile the current obligation. Closure refund/balance uses `SETTLEMENT_PAYMENT_OVERDUE` alone, not a second payment deadline notice.

`PAYMENT_REQUEST_CREATED` retains its existing schema/copy/route and also covers actual positive inserts of deposit refunds, settlement balances, amendment deposit deltas and agreed early-exit rent refunds. Core chooses the persisted payer, including reversed refund direction; returning an existing row emits nothing. Cancellation-only refunds are not included in this creation extension. Existing common transfer/receipt/dispute notifications continue unchanged; no fake zero payment, receipt, automatic possession or new advance reminder is introduced.

Root events use contractId as aggregate/Kafka key; payment events use paymentId. One immutable eventId per real transition and recipient; business change and outbox are atomic, and replay remains idempotent by `(recipientId, sourceEventId)`. Different aggregates/outboxes have no cross-family delivery-order guarantee. Any extra data (status, side, actor, version, amount, reason, note, date/deadline, bank, evidence, signature, URL/path) or fanout is rejected to the redacted DLT. No preference, schema, topic or config change; push stays the generic signal.

See `checklist/RETURN_SETTLEMENT_NOTIFICATIONS.md` for frozen triggers, recipients, consolidation and deadline ownership. **Rollout order:** every consumer replica → web → Core. Older strict consumers quarantine the new event types and commit their offsets; recovery requires the retained source record republished with the same immutable eventId after upgrading.

**Smoke:** `npm run test:backend` covers all nine root types and the payment deadline type, duplicate replay, exact routes/metadata/category, outsider read/delete denial, persistence with CONTRACT/PAYMENT delivery preferences disabled, and invalid private-field/fanout/cross-family payloads in the redacted DLT. Only `homespace_notification_test` and random `homespace.notification.test.*` topics are used, push/socket are off, and test records/topics are retained.

## Publish and inspect

Kafka UI is available in the local development infrastructure at http://localhost:9022. Create a dedicated source topic and DLT (for example `hs.notifications.test.v1` and `hs.notifications.test.dlt.v1`) without altering existing topics. Use the same names in service config. Three partitions are a reasonable initial production count; use a resource ID key consistently to retain resource ordering. Processing is sequential per consumer; ordering is only guaranteed within a partition. A poison event moved to DLT permits later events to proceed.

Copy `scripts/kafka-listing-approved.json` or `scripts/kafka-announcement.json`, replace the recipient with the authenticated test user's Keycloak subject, and set a fresh event ID for a new notification. In PowerShell:

```powershell
$env:KAFKA_BROKERS='localhost:9092'
$env:KAFKA_EVENTS_TOPIC='hs.notifications.test.v1'
node scripts/kafka-publish.cjs scripts/kafka-listing-approved.json
```

The publisher uses the backend contract validator and never creates topics. In Kafka UI, select the source topic and publish the fixture as the record value, with the resource ID as key. For invalid-event testing, UI may publish malformed JSON or version 2; those should reach DLT without notifications. Re-publish the same event ID to verify no duplicate per recipient. Check authenticated `GET /api/v1/notifications/feed` through the Gateway (internal controller route: `/feed`); there is no public creation route.

## Durability and recovery

The source offset is committed only after every recipient's idempotent notification persistence completes, or after an invalid poison message is acknowledged by the DLT broker. A partial fanout retries the complete envelope safely. Retries are bounded in one delivery; exhausted persistence/enqueue failures throw a redacted retriable error, and a crash or failed DLT send leaves the source offset uncommitted for Kafka replay. KafkaJS restarts retriable consumer failures; non-retriable failures require process supervision/restart. Graceful shutdown stops consumption before disconnecting. Enable Nest shutdown hooks in application bootstrap. An enabled consumer fails application startup when broker connection/subscription fails; disabled Kafka does not establish a connection.

DLT contains only source topic/partition/offset, a reason code and payload SHA-256. It excludes body, recipients, keys, headers and exception details. Restrict both topics by ACL, apply retention appropriate to personal data, and monitor DLT count and consumer lag. To recover, authorized operators retrieve the original retained source record at the coordinates, repair producer/schema or infrastructure, then republish with the same immutable event ID. Never reset the shared production group to replay a single record. DLT redaction means recovery requires the retained source; retention expiration prevents replay. DLT and source commits are not transactional, so duplicate DLT records are possible after a crash; deduplicate by source coordinates.

Focused checks: `npm test -- --runInBand src/modules/notification-events` and `npm run build` (Nest production compilation).

