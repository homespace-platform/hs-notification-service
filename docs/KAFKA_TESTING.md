# Kafka notification ingestion v1

Enable `KAFKA_ENABLED=true` only with all Kafka environment values supplied: `KAFKA_BROKERS` (comma separated hosts), `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`, `KAFKA_EVENTS_TOPIC`, `KAFKA_DLT_TOPIC`, `KAFKA_RETRY_ATTEMPTS` (integer 1..10), `KAFKA_RETRY_DELAY_MS` (integer 0..10000). Use different source/DLT topics. Provision topics before startup; auto creation is disabled. Restrict source produce permissions to trusted business services and test operators. The consumer trusts producer recipient selection; never expose a public HTTP notification creation endpoint.

The exact v1 envelope contains `eventId`, `eventType`, `version: 1`, `occurredAt` (UTC ISO with milliseconds), `recipients` (1..100 unique Keycloak user IDs), and `data`. IDs accept ASCII letters/digits followed by letters/digits/underscore/hyphen, maximum 200 characters. Unknown properties are rejected. Each event ID must be globally unique and immutable: reusing it for the same recipient keeps the existing notification. Recipients come from authorized business producers, with no Core API lookup.

| Event types                                                    | Required data                  | Category    |
| -------------------------------------------------------------- | ------------------------------ | ----------- |
| LISTING_APPROVED, LISTING_REJECTED                             | listingId                      | LISTING     |
| BOOKING_REQUESTED, BOOKING_CONFIRMED, BOOKING_CANCELLED        | bookingId                      | APPOINTMENT |
| CONTRACT_AWAITING_SIGNATURE, CONTRACT_SIGNED, CONTRACT_EXPIRED | contractId                     | CONTRACT    |
| PAYMENT_SUCCESSFUL, PAYMENT_FAILED, PAYMENT_OVERDUE            | paymentId                      | PAYMENT     |
| CHAT_MESSAGE_RECEIVED                                          | conversationId                 | CHAT        |
| PLATFORM_ANNOUNCEMENT                                          | title (1..200), body (1..2000) | SYSTEM      |

Resource events use fixed templates and `/notifications` as the verified route; resource IDs remain in metadata until product-specific detail routes are confirmed. Announcements accept plain text only (no HTML/control characters), with no producer URLs. All priorities are NORMAL. Private chat text, financial details and rejection reasons are deliberately absent.

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

