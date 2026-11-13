# Checklist thông báo tin đăng

Cập nhật: 13/11/2026. Phạm vi: quyết định về tin đăng của admin và hết hạn hiển thị. Risk L3: identity/ownership, transaction, concurrency và contract Kafka giữa các repo. Không coi compile hoặc đọc test là đã chạy test.

## 1. Phân công và repo

- [x] Hai worker Codex Sol 6.1 xhigh rà độc lập luồng Core và contract/frontend; lập ma trận trước khi sửa.
- [x] Claude Sonnet 5.5 high triển khai Core và consumer/web trong hai phần không trùng repo.
- [x] Codex viết regression tests; lỗi source giao lại Claude sửa.
- [x] Hoàn tất focused tests sau bản sửa cuối; kiểm tra diff từ các worker đạt. Kết quả và skip ghi ở mục 5.
- Repo thay đổi: `hs-core-api`, `hs-notification-service`, `hs-web-app`. `hs-admin-portal` được rà: UI đã gọi đúng quyết định theo pendingEditId và tự reload sau thao tác, không cần sửa để phát thông báo. Không đổi infra/topic/Gateway.
- Giữ nguyên việc người dùng xóa `docs/memory.md`; không tạo lại. Không commit/push hoặc sửa `.env`.

## 2. Ma trận người nhận và sự kiện

Người nhận lấy từ `Listing.ownerId` đã lưu; không nhận recipient từ frontend. Các thao tác admin nếu actor chính là owner sẽ không tạo notification tự gửi. Người thao tác giữ toast CRUD sẵn có.

| Quyết định/thao tác | Event | Chi tiết và trường hợp loại trừ |
|---|---|---|
| Admin tạo tin cho chủ nhà khác | `LISTING_CREATED` | Draft hoặc pending; không khẳng định đã duyệt |
| Admin lưu chỉnh sửa trực tiếp cho chủ nhà khác | `LISTING_UPDATED` | Sau save/storage/address/snapshot thành công; không phải duyệt pending edit |
| Duyệt đăng mới/đăng lại/khôi phục vi phạm thành PUBLISHED | `LISTING_APPROVED` | Không phát thêm status-changed cho cùng quyết định |
| Từ chối tin đang chờ duyệt | `LISTING_REJECTED` | Chủ tin mở detail để xem lý do; không đưa reason vào Kafka/push |
| Duyệt đúng pendingEditId | `LISTING_EDIT_APPROVED` | Phân loại theo quyết định, không suy ra từ status cuối; có thể vẫn hidden/reserved/rented/expired |
| Từ chối đúng pendingEditId | `LISTING_EDIT_REJECTED` | Lưu exact editId trước khi clear; không khẳng định toàn bộ tin bị từ chối |
| Admin chuyển sang PENDING_REVIEW | `LISTING_STATUS_CHANGED` + status | Không gọi là duyệt đăng thành công |
| Admin ẩn tin | `LISTING_STATUS_CHANGED` + HIDDEN | Appointment cancellation cho các bên liên quan vẫn là event BOOKING riêng |
| Admin đánh dấu vi phạm | `LISTING_STATUS_CHANGED` + VIOLATION | Nếu đồng thời bỏ pending edit thì chỉ báo vi phạm, không thêm edit-rejected giả |
| Admin ghi nhận cho thuê ngoài | `LISTING_STATUS_CHANGED` + RENTED_EXTERNALLY | Không giả lập luồng ký hợp đồng |
| Admin chuyển tin hết hạn | `LISTING_EXPIRED` | Một sự kiện cho quyết định thành công |
| Scheduler hết hạn hiển thị | `LISTING_EXPIRED` | Gồm operational PUBLISHED → EXPIRED trong khi display còn PENDING_REVIEW; không mất pending edit |
| Owner tạo/lưu/duplicate/submit/ẩn/đổi trạng thái của mình | Không tạo notification tin đăng | Có phản hồi/toast thao tác; giữ thông báo BOOKING cho người khác nếu nghiệp vụ có |
| Validation fail, stale editId, trạng thái không cho phép, transaction rollback | Không có event đã commit | Không báo thành công trước khi nghiệp vụ chắc chắn được lưu |
| Reserve/release do yêu cầu thuê, ký/handover hợp đồng | Chưa tích hợp ở đợt này | Thuộc luồng rental/contract sau; không tạo false LISTING_APPROVED từ generic status hook |

Mỗi lần admin save trực tiếp được nghiệp vụ hiện tại coi là một cập nhật/revision; hai lần save thành công riêng biệt có thể tạo hai notification. Retry publish **cùng outbox row** phải giữ eventId/payload và không nhân đôi notification.

## 3. Contract và tính bền vững

- [x] Giữ envelope v1: `eventId,eventType,version,occurredAt,recipients,data`; timestamp UTC đúng ba số millisecond. Không đổi topic, REST, socket event hoặc category.
- [x] Cả 8 loại dùng category `LISTING`, priority `NORMAL`; parser strict theo loại, xem [KAFKA_TESTING.md](../KAFKA_TESTING.md).
- [x] `listingId` bắt buộc; `listingTitle` plain text tối đa 120 ký tự là tùy chọn. Chỉ EDIT event bắt buộc `editId`; chỉ STATUS_CHANGED bắt buộc `status` trong `PENDING_REVIEW,HIDDEN,VIOLATION,RENTED_EXTERNALLY`. Field lạ bị từ chối. Event APPROVED/REJECTED cũ chỉ có listingId vẫn nhận.
- [x] Không đưa reason/address/phone/pending payload/URL do producer truyền vào event; push vẫn generic. Reason chỉ đọc qua detail sau xác thực.
- [x] Thêm `listing_notification_outbox` riêng, không dùng listing ID trong `booking_id`. Enqueue MANDATORY cùng transaction nghiệp vụ; Kafka send sau commit với key listingId. Publisher không vượt unsent head cùng listing, claim SKIP LOCKED, chỉ đánh dấu sent sau ack. Retry giữ UUID/payload đã lưu.
- [x] Quyết định edit giữ editId trước khi xóa pending fields. Khóa listing, status guard, snapshot capture và các side effect hiện có được giữ.
- [x] Đối chiếu thực tế 8 fixture Java `hs-listing-service/target/listing-event-contracts.json` qua source parser/render Node: đúng loại, owner, context, metadata và route. Không có listingTitle trong metadata.
- [x] Kiểm tra retry/rollback/concurrent publish trên PostgreSQL test thật: 10 ca listing mới đạt, không skip. Có kiểm tra failed-send, crash window sau ack/trước DB mark, khóa row và SKIP LOCKED không vượt head cùng listing.

## 4. Web

- [x] Render route cố định `/dashboard/properties/view?id=<encoded listingId>` cho cả tin published/pending/rejected/hidden và kết quả edit; notification cũ giữ actionPath đã lưu trước đó.
- [x] Dropdown, trang notification và popup LISTING dùng subtype badge; giữ category/tab hiện có và popup góc dưới trái, toast CRUD góc trên phải.
- [x] Thêm tín hiệu `listing-changed`, invalidation cả khi tab ẩn; recovery sau socket connect/focus/visibility/push. Không dùng unread/read/delete làm trigger reload listing.
- [x] Chỉ subscribe ở list/detail đang mở; coalesce burst và chờ refresh thật; membership tách riêng. Không auto-reload form upsert làm mất dữ liệu đang nhập.
- [x] Detail lấy authenticated API, kiểm tra ownerId/userId và ID, bỏ public fallback, giữ query/hash khi login, không cho response cũ ghi đè tài khoản/tin mới.
- [x] Regression sau sửa lỗi dữ liệu account cũ hiện trước effect reset và list/count refresh chồng nhau: các assertion đã tái hiện lỗi trước sửa nay đạt; web 29/29 focused tests.
- [ ] Browser E2E bằng hai tài khoản thật sau khi restart service.

## 5. Verification thực tế

| Kiểm tra | Kết quả tại mốc đang thực hiện |
|---|---|
| Core | Tổng hợp báo cáo mới nhất theo suite: 204 đạt, 0 lỗi, 6 skip trên 210 ca; không phải một invocation duy nhất. Writer 19/19, listing service 55/55, status 97/97, admin review 8/8, appointment writer 2/2, appointment service 8/8, appointment PostgreSQL 5 đạt/1 skip, listing PostgreSQL mới 10/10; legacy moderation 5 skip. Các module tới contract đã compile/test-compile đạt |
| Core writer bug/regression | Lần đầu 18/19 đạt, lỗi Set.contains(null) đã được Claude sửa guard; Codex tự chạy lại cả suite, 19/19 đạt |
| Notification focused tests | 123/123 đạt, không skip: event schemas, application, realtime và generic Firebase payload mock; `npm run build` và production tsconfig typecheck đạt; oxlint file liên quan đạt |
| Web focused tests | 29/29 đạt, không skip; gồm account isolation, stale response, in-flight coalescing, detail ownership/login/deep-link, generic push worker, booking và edit retry regressions. Global TypeScript và ESLint file sửa đạt |
| Java → Node contract | 8/8 payload Java thật qua strict parser/render đạt |
| PostgreSQL | DB mới riêng `core_booking_notification_test_listing_1b20259db397`; chỉ Core tester dùng để create-drop, không dùng database dev. Các ca rollback, outer snapshot failure, appointment failure, competing decisions, pending-review expiry, replay/order và concurrent claims đã thực thi đạt |
| Kafka → MongoDB → REST | Root chạy `npm run build` rồi `npm run test:backend`: exit 0, đủ 8 loại/4 status listing, legacy id-only, duplicate replay, metadata/route/isolation; booking 9 loại × 2 phía và backend regressions cũng đạt. Chỉ dùng `homespace_notification_test` và topics `homespace.notification.test.*`; realtime/FCM bị tắt trong smoke |
| Browser/Chrome push | Chưa chạy trong đợt này |

Các skip Core: 1 ca Kafka publisher thật cần biến broker/topic riêng và 5 ca legacy moderation dùng guard database khác. Suite PostgreSQL listing mới không mock occupancy SQL; đặt ở `hs-contract-service` để schema contracts/closures thực sự tồn tại. Không coi các ca skip là đạt.

Lệnh focused do Codex chạy: module-scoped Maven `-Pisolated-build -pl hs-contract-service -am` với danh sách test chọn ở trên; notification `npm test -- --runInBand src/modules/notification-events src/modules/notification/application/notification.service.spec.ts src/modules/notification-realtime src/modules/notification-delivery/firebase-push.provider.spec.ts`; web `node --test tests/listing-notification.test.mjs tests/notification-booking-label.test.mjs tests/notification-worker.test.cjs tests/listing-detail-access.test.cjs tests/listing-edit-retry.test.cjs`. Test web dùng VM hooks/timers/API fakes, không phải DOM browser thật.

Global notification `tsc --noEmit` còn hai lỗi test typing đã tồn tại ở `admin-broadcast.service.spec.ts:57` và `admin-broadcast.controller.spec.ts:14`; production build/typecheck đạt. Không sửa test unrelated chỉ để làm global check xanh.

## 6. Rollout và schema

1. Consumer notification mới phải chạy trước Core mới, vì consumer cũ strict sẽ DLT các type/field mới. Không trộn consumer cũ trong cùng group sau khi producer bật. Consumer mới vẫn nhận payload listing cũ.
2. Core cần bảng/index mới trước khi enqueue hoặc publisher chạy. Local dùng `JPA_DDL_AUTO=update` có thể tạo từ entity; môi trường validate/không auto-DDL phải dùng migration được duyệt. DDL additive bên dưới chỉ là hướng dẫn, **chưa áp dụng vào database nghiệp vụ**:

```sql
CREATE TABLE IF NOT EXISTS listing_notification_outbox (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    event_id VARCHAR(36) NOT NULL UNIQUE,
    listing_id VARCHAR(36) NOT NULL,
    topic VARCHAR(255) NOT NULL,
    payload TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_listing_outbox_pending
    ON listing_notification_outbox (sent_at, id);
CREATE INDEX IF NOT EXISTS idx_listing_outbox_listing
    ON listing_notification_outbox (listing_id, id);
```

3. Không thay cấu hình topic/secret. Outbox dùng các property `notification.events-topic`, `notification.outbox.enabled`, `notification.outbox.poll-delay-ms` đã có. Kiểm tra backlog khi bật lại publisher; không xóa outbox để test.

## 7. Kiểm tra UI cần thực hiện

| Tình huống | Mong đợi | Kết quả |
|---|---|---|
| Chủ tin A gửi pending, admin B duyệt/từ chối | A nhận một popup + feed; B chỉ toast; click mở đúng detail và lý do sau xác thực | Chưa chạy |
| A sửa tin, B duyệt/từ chối đúng editId | Nhãn EDIT riêng; status cuối phù hợp thực tế; bấm vào thấy detail hiện tại | Chưa chạy |
| B ẩn/vi phạm/chuyển chờ duyệt/cho thuê ngoài | Một notification đúng quyết định; không tạo approval/edit-rejected giả | Chưa chạy |
| Admin tạo/sửa trực tiếp cho A | A được báo, admin là owner thì không tự gửi | Chưa chạy |
| Scheduler hết hạn, có/không có pending edit | Báo hết thời hạn hiển thị; giữ pending edit khi có | Chưa chạy |
| List/detail đang mở; nhiều event liên tiếp; đổi filter | Data/counts cập nhật, không request storm, không refetch membership theo mọi event | Chưa chạy |
| Đổi tài khoản A → C, URL ID thay đổi khi request cũ chưa xong | Không hiển thị dữ liệu A, không hiện owner controls cho C, không public fallback | Chưa chạy |
| Đóng tab HomeSpace, Chrome thường còn chạy, đã đăng ký push | Generic OS push; click mở notification center rồi vào owner detail sau xác thực | Chưa chạy |

Giới hạn giữ nguyên: Socket.IO một replica; sent outbox chưa có purge/retention tự động; push không chứa nội dung riêng tư. Mismatch sẵn có của admin edit reason UI 2000 ký tự so với API edit limit 1000 nằm ngoài đợt này; quyết định API fail không được tạo notification thành công.
