# Admin delivery health

`GET /admin/delivery-health` on notification-service; through Gateway use
`GET /api/v1/notifications/admin/delivery-health`. No request DTO/body or query parameters are needed.
GatewayAuthenticationGuard validates `X-Internal-Secret` before reading identity/authorities;
AdminGuard requires verified `role=ADMIN`, and SystemHealthViewGuard requires the exact
`SYSTEM_HEALTH_VIEW` authority. No public identity input is accepted. Existing guards and their
secret verification are unchanged.

The response uses `ApiResponseDto<DeliveryHealthResponse>` (`code:1000`, `result`) and
`Cache-Control: private, no-store`. The service coalesces concurrent requests and caches the
aggregate for 15 seconds. Real UTC time defines `asOf` and `windowStart` (24 hours earlier).

`result` has these fields:

- `asOf`, `windowStart`: ISO UTC timestamps.
- `email`: `enabled`, `source`, `pending`, `processing`, `failed24h`, `skipped24h`, `sent24h`,
  `accepted24h`, `retryDue`, `oldestPendingAgeSec`, `byErrorCode24h`.
- `push`: the same fields, plus `devicesDeactivated24h:null` and
  `devicesSource:UNAVAILABLE_NO_DEACTIVATION_HISTORY`.
- `kafka`: `enabled`, `lag:null`, `dlt:{notification:null,news:null}`,
  `source:UNAVAILABLE_NO_LOCAL_KAFKA_METRICS`.
- `loops`: `email:null`, `push:null`, `eureka:null`,
  `source:UNAVAILABLE_NO_LOOP_HEARTBEATS`.
- `notes`: fixed explanations of current-state counts, accepted delivery, missing age and enabled flags.

Each channel uses one Mongo `$facet` aggregate, capped at 2500 ms server execution with a
3000 ms source deadline, driver timeout and abort signal. Projection excludes recipient,
payload, device tokens and provider message IDs before aggregation. Output size is fixed by the
error-code allowlist (HTTP 4xx/5xx grouped; unknown codes become `OTHER`). Counts cover all stored
jobs, without a row cap or per-recipient queries. `retryDue` counts current pending rows whose
`nextAttemptAt <= asOf`; this includes first attempts. `oldestPendingAgeSec` is the age of the
oldest current pending row; an empty/undated queue returns null. Channel `source` is
`AVAILABLE_MONGO_CURRENT_STATE` on success. A failed source returns
`UNAVAILABLE_MONGO_AGGREGATION` and null counts/maps, while the other source remains available;
raw exceptions never appear in the response or a new log.

24h counters and error counts describe current rows with `updatedAt` in `[windowStart, asOf)`;
these are not a send/failure transition ledger. `sent24h` applies to email and `accepted24h` to
push; the other channel's state count is zero because that state does not exist there.
Firebase acceptance does not prove display or read. `enabled` describes configured channel
enablement, not provider connectivity. Inactive device `updatedAt` cannot prove when or why a
device was deactivated; no historical deactivation count is invented. Kafka lag/DLT offsets and
loop heartbeats have no current local metric source; this change neither calls brokers nor adds
the deferred job instrumentation or operational monitor. No runtime provider calls occur.

Read-only inspection of Gateway `UserHeaderFilter.java` shows inbound identity/secret headers
are stripped, verified `X-User-Authorities` is forwarded, and route `notification-service-route`
adds the internal secret. `GatewayRouteAuthorization` already protects `notifications/admin/**`.
No Gateway change was made; deployed end-to-end forwarding still needs integration validation.

Validation (2026-11-28):

- `npm test -- --runInBand src/modules/notification-delivery/delivery-health.spec.ts src/modules/authentication/presentation/guards`:
  3 suites, 22 tests passed. Covers missing/forged/wrong secret, USER with forged ADMIN authority,
  ADMIN lacking permission, narrow authorized ADMIN, envelope/cache, concurrent caching, bounded
  projections, date/due boundaries and independent source failure with redacted errors.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run build`: passed.
- After adding the explicit source deadline, final
  `npm test -- --runInBand src/modules/notification-delivery/delivery-health.spec.ts`: 11 passed,
  including a stalled-source timeout/abort test; typechecking and build passed again.

These focused checks use injected Mongo/provider mocks. No existing MongoDB, Kafka, Firebase,
email provider, `.env` file or other live service was used. Real Mongo pipeline execution and
deployed Gateway forwarding remain unverified; no existing state/lease/offset logic was changed.
