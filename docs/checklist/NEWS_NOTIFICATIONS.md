# News publication notifications

- [x] News → `homespace.news.events.v1` source Kafka → Core audience selection/durable outbox → existing notification Kafka → notification-service. The empty-recipient source event is consumed only by Core; notification-service rejects `recipients: []`.
- [x] Targeted `NEWS_PUBLISHED` v1 requires 1..100 unique valid recipients, stable `eventId: news_<newsId>`, and data exactly `{newsId, slug}`; all other event recipient rules remain strict.
- [x] Notification-service only persists targeted recipients, heartbeats per recipient, and commits only after every recipient in the batch is persisted. No callback HTTP or user-directory requests remain.
- [x] Removed outgoing directory configuration from notification env validation, example and local env. The existing `GATEWAY_INTERNAL_SECRET` inbound authentication guard remains required.
- [x] Replays/chunks use the existing unique `(recipientId, sourceEventId)` key; transient MongoDB failure retains the targeted source record for retry.
- [x] `NEWS` push preference defaults to enabled and can be turned off. Email preference is stored but there is no email sender; in-app records are always stored.
- [x] Generic notification copy links to `/news/<slug>` and contains no producer title, summary, or private content.
- [x] Manual admin broadcast ownership also moves to Core: Gateway preserves the existing public path, Core returns HTTP 202 `{broadcastId, status: 'QUEUED'}`, and its outbox emits targeted `PLATFORM_ANNOUNCEMENT` events. Notification-service's former admin controller/service/DTO are removed.
- [x] Focused Jest: 16 suites, 626 tests passed on 15/11/2026, covering notification event families, News targeted delivery/replay/retry, empty-recipient DLT, admin/legacy announcement validation, configuration, Gateway secret guard and feed controller. `npm run lint` and `npx tsc --noEmit --incremental false` passed.
- [x] Core: 14 unit/controller tests and 5 PostgreSQL tests passed on a newly created isolated rollout database, covering role/status/cutoff, duplicate/conflicting requests, concurrent workers, restart checkpoints, and Kafka ACK followed by checkpoint failure. Hibernate created the entity schema in that test database; no application database was changed.
- [x] News: 23 focused tests, TypeScript and lint passed. Infra: quiet Compose validation passed. Gateway: 12 focused routing/authentication tests passed. Admin portal: TypeScript and targeted ESLint passed; acceptance message matches HTTP 202.
- [x] Rollout: initialize news source and source DLT topics via the existing `hs-infra` kafka-topics job; use Hibernate entity mapping for database recreation; update notification consumers before Core, then Gateway/admin and News. Recovery of retained old empty-recipient events is documented in `hs-infra/README.md`.
- [x] Local news source and DLT topics were initialized on 15/11/2026; Core group `notification-broadcast-core-v1` is assigned `homespace.news.events.v1:0`. Existing topics and data were preserved.
- [ ] Live Kafka source → Core → notification-service → MongoDB/FCM and browser behavior remain unverified in this change. No application schema was changed manually.

## Popup preferences and stale tabs (15/11/2026)

- [x] `notification:new` adds server-calculated `popupAllowed` from the recipient/category push preference. All nine categories and every priority (including `URGENT`) honor push opt-out; email is independent. Missing preferences default on; lookup errors suppress popups. Stored feed, unread counts, feed/domain refresh events and replay deduplication remain intact; REST notification views are unchanged.
- [x] `PATCH /preferences` accepts only `{category, channel, enabled}` for the authenticated user. Atomic Mongo updates preserve other categories/channels across stale tabs and concurrent first updates. Existing `PUT` replacement/default-reset behavior remains supported.
- [x] Popup-focused Jest: 10 suites, 235 tests passed (six existing Mongo dispatcher tests skipped). PATCH/service/HTTP/hooks verification: four suites, 145 tests passed. The dedicated preference repository run then passed all five tests, including three real Mongo concurrency/default/isolation checks in a fresh `notification_preference_test_<uuid>` database; no application database was touched.
- [x] `npm run lint` and `tsc --noEmit --incremental false` passed. Mocked dispatcher checks confirm push opt-out produces `skipped` without calling Firebase for all categories/priorities.
- [x] Web: 10 focused popup/preferences/registration-status tests, TypeScript and targeted ESLint passed. Settings sends only the changed channel; a late-mounted settings page reads the cached registered status. Suppressed popups still refresh every integrated business domain.
- [ ] A broader web notification test run encountered an existing invoice-route assertion still expecting removed `moveIn`/`agreementId` props (`hs-web-app/tests/invoice-notification.test.mjs:339`); the invoice route and that assertion were not changed in this fix.
- [ ] Live Kafka/FCM delivery and browser smoke checks remain unverified; no live Firebase call was made.
