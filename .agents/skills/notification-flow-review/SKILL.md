---
name: notification-flow-review
description: Review HomeSpace notification flows end to end - Kafka event contracts, idempotency and DLT behavior, MongoDB persistence, recipient authorization, push job lifecycle, Firebase errors and realtime compatibility. Use when an explicit notification flow review is requested.
---

# Notification Flow Review

## Mode

Review-only by default. Do not edit files unless the user asks for fixes. Do not call live Firebase, Kafka or MongoDB.

## Procedure

Read only the code and docs relevant to the change (`docs/KAFKA_TESTING.md` for the event contract, `docs/NOTIFICATION_PROGRESS.md` for implemented behavior).

1. **Event contracts.** Compare producer payloads with the consumer validator (`notification-event.ts`): envelope fields, version, event types, required data, unknown-property rejection, templates and route construction. Check that producers elsewhere (for example `hs-core-api`) match.
2. **Kafka idempotency and DLT.** Duplicate `eventId` per recipient must not create duplicates. Offsets are committed only after persistence or DLT acknowledgement. Retries are bounded; infrastructure failures leave the offset uncommitted; invalid events go to the DLT with redacted content.
3. **MongoDB persistence.** Unique `(recipientId, sourceEventId)`, recipient isolation, read/unread/soft-delete semantics, cursor pagination, index and migration impact.
4. **Recipient authorization.** Every REST path scopes by the verified identity. No client-supplied user IDs. Admin broadcast stays admin-only. Gateway secret check is intact.
5. **Push job lifecycle.** Job creation, lease, retry limits, crash recovery, preference checks before sending, and state transitions (`pending`, `processing`, `accepted`, `failed`, `skipped`).
6. **Firebase delivery errors.** Invalid or expired tokens, provider outages and quota errors are handled without losing the in-app notification; `accepted` is not treated as read; installation ownership and secrets are protected; no private content in push payloads.
7. **Realtime compatibility.** JWT/JWKS verification, origin allowlist, room membership by `sub`, token expiry disconnect, event payload compatibility with `hs-web-app`, and no REST failure caused by realtime failure.
8. **Regression tests.** List the Jest tests that cover each changed behavior and which are missing (duplicate event, invalid event, unauthorized access, provider failure, reconnect).

## Output

Findings ordered by severity with file and line references, the failure scenario for each, and missing tests. State what was read and what was not verified (for example: no live Kafka, MongoDB or Firebase run). If no issue is found, say so.
