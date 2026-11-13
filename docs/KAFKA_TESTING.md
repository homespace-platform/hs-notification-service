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

Focused checks: `npm test -- --runInBand src/modules/notification-events` and `npx tsc --noEmit --incremental false`.

