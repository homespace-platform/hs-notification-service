# Email module "Tài khoản & Bảo mật" (category ACCOUNT)

Kết quả audit chỉ đọc. Mọi đường dẫn tương đối với `D:\Projects\homespace`. Viết tắt: NS = hs-notification-service, CORE = hs-core-api.

## 0. Hiện trạng nền tảng (bằng chứng)
- Email hiện chỉ gửi cho `SYSTEM` + `PLATFORM_ANNOUNCEMENT`, opt-in (`NS/src/modules/notification-delivery/email-outbox.ts:35,174-176`; `email-delivery.service.ts:58-62,128`). Template duy nhất: `templates/system/index.ts`. Idempotency job: `notificationId` unique (`email-outbox.ts:51`), Resend key `sourceEventId:recipientId` (`email-delivery.service.ts:135`).
- Event Kafka ACCOUNT không có email người nhận, chỉ có `recipients=[userId]`; địa chỉ lấy qua `UserEmailDirectory` (`email-delivery.service.ts:78`, `user-email.directory.ts:9`).
- Mọi event ACCOUNT: `data` rỗng hoặc chỉ `{attemptId}`; schema từ chối field lạ (`NS/src/modules/notification-events/coverage-completion.spec.ts:24-29`). Copy in-app: `notification-event.ts:229-241` (role/disable/enable), `:468-470` (KYC).
- Pref đã có cờ `email` theo category (`email-outbox.ts:176` chỉ đọc SYSTEM; `mongo-notification-preference.repository.ts:41` reset email=false).

## 1. Bảng event
| eventType | Trigger (file:line) | Người nhận | Tiêu đề in-app | Email? | Lý do |
|---|---|---|---|---|---|
| ACCOUNT_DISABLED | `CORE/hs-user-service/.../service/impl/UserServiceImpl.java:353-356` (updateUserStatus, chỉ khi đổi trạng thái; bỏ qua nếu actor = chính chủ, `AccountNotificationWriter.java:46`) | Chủ tài khoản bị khóa | Tài khoản đã bị vô hiệu hóa | Có | Bảo mật, người dùng không đăng nhập được nên không thấy bell; email là kênh duy nhất còn lại |
| ACCOUNT_ENABLED | `UserServiceImpl.java:353-356` | Chủ tài khoản | Tài khoản đã được kích hoạt lại | Có | Báo kích hoạt lại, cũng là cảnh báo nếu không phải chủ ý |
| ACCOUNT_ROLE_CHANGED | `UserServiceImpl.java:120-123` (admin updateUser, chỉ khi `roleChanged`) | Chủ tài khoản | Quyền truy cập tài khoản đã thay đổi | Có | Thay đổi quyền là sự kiện bảo mật |
| KYC_VERIFIED (VNPT) | `.../service/kyc/VnptKycStore.java:133,137-139` | Chủ KYC | Kết quả xác minh danh tính | Có | Kết quả quan trọng, mở khóa chức năng (gate) |
| KYC_VERIFIED (ADMIN thủ công) | `.../kyc/AdminKycService.java:70,75` (writer chỉ cho ADMIN+VERIFIED, `AccountNotificationWriter.java:68-69`) | Chủ KYC | như trên | Có | Cùng loại, dùng chung template |
| KYC_REJECTED (VNPT) | `VnptKycStore.java:129,131,137-139` | Chủ KYC | Xác minh danh tính chưa được chấp nhận | Có | Cần hành động lại; KHÔNG kèm lý do (rejectionReason ở `:129,131` chứa thông tin riêng) |
| KYC_RETRY_REQUIRED | `VnptKycStore.java:99`; nhắc định kỳ `KycRetryNoticeScheduler.java:34-37` | Chủ KYC | Cần thực hiện lại xác minh danh tính | Có (chỉ lần từ `VnptKycStore:99`) | Cần hành động. Scheduler nhắc lặp: không email để tránh spam, chỉ in-app |
| Cập nhật hồ sơ | `UserServiceImpl.java:286-306` | Không có event | - | Không (chưa có) | Người dùng tự thao tác, không đáng email. Đổi email/SĐT nằm ở mục Gap |
| Đổi mật khẩu | `UserServiceImpl.java:224-227` | Không có event | - | Gap | Xem mục 3 |
| Đăng nhập thiết bị mới | không có | - | - | Gap | Xem mục 3 |
| Đổi/thêm/xóa tài khoản ngân hàng | `CORE/hs-payment-service/.../BankAccountService.java:27,82,109,127` | Không có event | - | Gap | Xem mục 3 |
| MEMBERSHIP_EXPIRING_SOON/EXPIRED | `AccountNotificationWriter.java:81-84` (category PAYMENT) | - | - | Ngoài module | Thuộc module Thanh toán |

## 2. Chi tiết cho từng event "Có"
Quy ước chung: layout `renderEmail` với `category: 'Tài khoản & Bảo mật'`, badge theo mức; CTA mở `${MAIL_APP_BASE_URL}/settings/account-security` (route cố định, `coverage-completion.spec.ts:6`); idempotency Resend `<sourceEventId>:<recipientId>` (giữ cơ chế `email-delivery.service.ts:135`; bỏ `replace(/^admin_/)` chỉ áp cho SYSTEM). `sourceEventId` KYC xác định (`UUID.nameUUIDFromBytes(type:recipient:attemptId)`, `AccountNotificationWriter.java:88`), role/disable/enable dùng `randomUUID` (`:47`) nên chống trùng dựa vào unique `(recipientId, sourceEventId)` ở Kafka consumer.

| Event | Subject | Dòng chi tiết | CTA | Mặc định |
|---|---|---|---|---|
| ACCOUNT_DISABLED | `[HomeSpace] [Khẩn cấp] Tài khoản của bạn đã bị vô hiệu hóa` | Trạng thái: Đã vô hiệu hóa; Thời gian: occurredAt (giờ VN); Cách xử lý: liên hệ hỗ trợ | "Liên hệ hỗ trợ" (mailto/trang hỗ trợ) | Luôn gửi, không tắt được |
| ACCOUNT_ENABLED | `[HomeSpace] Tài khoản đã được kích hoạt lại` | Trạng thái: Đang hoạt động; Thời gian | "Đăng nhập" | Luôn gửi, không tắt được |
| ACCOUNT_ROLE_CHANGED | `[HomeSpace] [Quan trọng] Quyền truy cập tài khoản đã thay đổi` | Thời gian; "Do quản trị viên thay đổi"; lời nhắc liên hệ hỗ trợ nếu không mong đợi | "Xem tài khoản và bảo mật" | Luôn gửi, không tắt được |
| KYC_VERIFIED | `[HomeSpace] Xác minh danh tính đã hoàn tất` | Trạng thái: Đã xác minh; Thời gian | "Xem tài khoản" | BẬT (người dùng tắt được qua pref ACCOUNT) |
| KYC_REJECTED | `[HomeSpace] [Quan trọng] Xác minh danh tính chưa được chấp nhận` | Trạng thái: Chưa được chấp nhận; Thời gian; hướng dẫn thử lại chung | "Xác minh lại" | BẬT |
| KYC_RETRY_REQUIRED | `[HomeSpace] [Quan trọng] Cần thực hiện lại xác minh danh tính` | Trạng thái: Chưa hoàn tất; Thời gian | "Tiếp tục xác minh" | BẬT |

Dữ liệu cấm đưa vào email: CCCD/số định danh, họ tên đầy đủ, ngày sinh, ảnh giấy tờ, `rejectionReason`, `sessionUrl`, nhà cung cấp (VNPT/ADMIN), tên admin thực hiện, role cũ/mới, số tài khoản ngân hàng/tên chủ tài khoản, IP, thiết bị. `attemptId` chỉ dùng làm khóa, không hiển thị. Email người nhận không đi vào log/DLT.

## 3. Gap và khả năng thực hiện
1. **Đổi mật khẩu**: `updateUserPassword` chỉ gọi Keycloak (`UserServiceImpl.java:224-227`), không phát event. Keycloak có `UPDATE_PASSWORD`/`UPDATE_CREDENTIAL` trong `enabledEventTypes` (`hs-infra/keycloak/realm-export.json:1711-1722`) nhưng `eventsEnabled=false` (`:1706`) và provider chỉ chuyển `REGISTER`, `UPDATE_PROFILE`, `UPDATE_EMAIL`, `DELETE_ACCOUNT` (`KafkaEventPublisherProvider.java:12-16`). Khả thi (TB): cách A (nhanh) ở Core sau khi `keycloakUserService.updatePassword` thành công, enqueue `ACCOUNT_PASSWORD_CHANGED` qua writer. Cách B bao phủ cả "quên mật khẩu" (đổi ngoài Core): bật events + forward `UPDATE_PASSWORD`/`RESET_PASSWORD` vào topic mới, Core chuyển thành event ACCOUNT. B đụng hạ tầng + cần thay `UserSyncConsumer` (`:41-62`, action lạ chỉ `log.warn`).
2. **Đăng nhập thiết bị mới**: không có dữ liệu thiết bị/IP ở bất kỳ nơi nào đã đọc; `UserEventPayloadBuilder` không đưa IP. Khó (cao): cần bật `LOGIN`, lưu danh sách thiết bị đã biết (bảng mới), chống ồn, và PII (IP) trong email. Đề xuất hoãn sang giai đoạn sau; nếu làm thì email chỉ nêu "thiết bị mới" + giờ, không IP chính xác.
3. **Tài khoản ngân hàng đổi/thêm/xóa/đổi mặc định**: không có event; payment-service chưa có outbox thông báo. Khả thi (TB, ưu tiên cao vì rủi ro lừa đảo nhận tiền): trong `BankAccountService` (`:59,103,122,140`) ghi outbox cùng transaction, event `BANK_ACCOUNT_CHANGED` với `data={action: ADDED|UPDATED|DEFAULT_CHANGED|REMOVED}`, không số tài khoản. Cần copy writer/outbox theo mẫu `AccountNotificationWriter` (payment phụ thuộc user nên dùng lại được, `AGENTS.md` module order) và thêm type vào `notification-event.ts`.
4. **Đổi email/SĐT/username**: đi qua `updateUserProfile` (`:286-306`) và Keycloak `UPDATE_EMAIL` (`KafkaEventPublisherProvider.java:14`); không có event. Khả thi (TB) nhưng phải gửi tới email CŨ; event không mang email nên Directory phải trả email trước thay đổi, cần chốt thiết kế (rủi ro). Đề xuất pha 2.
5. **Trùng với Keycloak**: Keycloak đang tự gửi email verify (`verifyEmail=true`, `realm-export.json:35`) và reset mật khẩu (`resetPasswordAllowed`, `:38`) qua Gmail SMTP (`:1685-1703`). KHÔNG làm email NS cho hai luồng này. Email "đã đổi mật khẩu" của NS là bổ sung (xác nhận sau hành động), không thay email reset; để tránh gửi đôi, chỉ phát cho đổi mật khẩu từ Core (cách A) hoặc dùng `RESET_PASSWORD` làm trigger ở cách B, tuyệt đối không phát từ cả hai.

## 4. Thay đổi theo repo
**NS**
- `notification-delivery/email/templates/account/` (index.ts + hbs hoặc dùng `renderEmail` + chi tiết), có `email.spec.ts` kiểm escape, subject, link, không rò PII (dựa trên mẫu `system/index.ts`).
- `email-outbox.ts`/`email-delivery.service.ts`: tổng quát hóa "đủ điều kiện gửi" thành chính sách theo `(category,type)`: SYSTEM opt-in; ACCOUNT bảo mật (`ACCOUNT_*`, sau này PASSWORD/BANK) `mandatory` bỏ qua pref, KYC theo pref mặc định BẬT; chọn renderer theo type (hiện cứng `renderSystemBroadcastEmail`, `:128`); `content()` cần trả thêm `type`, `category`, `occurredAt`.
- `NotificationService.create`: gọi `enqueue` cho ACCOUNT (hiện chỉ SYSTEM + `PLATFORM_ANNOUNCEMENT`, theo `docs/EMAIL_RESEND.md:54`).
- Preferences: mặc định `email=true` cho ACCOUNT KYC (cần migration nhẹ vì reset cũ đặt false, `mongo-notification-preference.repository.ts:41`); UI hiển thị "Cảnh báo bảo mật luôn được gửi". Email người nhận chưa xác minh/không có: bỏ qua với `no-address` (có sẵn).
- Event mới (nếu làm): `ACCOUNT_PASSWORD_CHANGED`, `BANK_ACCOUNT_CHANGED` trong `notification-event.ts` (+ priority, route `/settings/account-security`, bảng copy, spec).
**CORE**: `UserServiceImpl` (password), `BankAccountService` + outbox/publisher mới ở payment (cùng transaction), cập nhật docs Kafka. Không đổi writer KYC/role/disable.
**hs-infra**: chỉ khi chọn cách B (bật events, forward thêm type, topic). Giữ SMTP Gmail của Keycloak.

## 5. Rủi ro
- Khóa tài khoản: người dùng bị khóa vẫn nhận email (đúng ý), nhưng bell không xem được; kiểm tra Directory vẫn resolve email của user `active=false` (chưa xác minh trong audit này).
- Chống trùng Kafka at-least-once với event `randomUUID` (role/disable) chỉ dựa unique `(recipientId, sourceEventId)`; nếu producer outbox retry cùng `eventId` thì ổn (`writer :47,62`).
- Spam: KYC_RETRY_REQUIRED lặp bởi scheduler, chỉ email lần đầu.
- PII: `rejectionReason` không bao giờ vào email; spec cần test từ chối field lạ.
- Resend giới hạn tốc độ (`EMAIL_SEND_INTERVAL_MS`): email bảo mật nên dùng hàng đợi ưu tiên riêng, tránh chờ sau đợt broadcast lớn.
- "Luôn gửi" cần quyết định pháp lý/nội dung (email giao dịch/bảo mật, không phải marketing).

## 6. Checklist theo thứ tự
1. Chốt chính sách (security luôn gửi, KYC theo pref BẬT) và nội dung/subject ở mục 2.
2. NS: policy `(category,type)` + renderer theo type + `content()` mở rộng; test.
3. NS: template `account/*` + `email.spec.ts`.
4. NS: gọi enqueue cho ACCOUNT trong `NotificationService.create`; migration pref ACCOUNT email=true.
5. Verify: Directory trả email của user bị khóa; thử end-to-end `ACCOUNT_DISABLED`, `KYC_VERIFIED`.
6. CORE: thêm `BANK_ACCOUNT_CHANGED` (payment outbox) + NS event/spec.
7. CORE: `ACCOUNT_PASSWORD_CHANGED` (cách A), cập nhật docs, tránh trùng email Keycloak.
8. Pha 2: đổi email/SĐT (email cũ), đăng nhập thiết bị mới (cần bật Keycloak events).
9. Cập nhật `docs/EMAIL_RESEND.md` và `docs/KAFKA_TESTING.md`; chạy `npm test -- --runInBand src/modules/notification-delivery src/modules/notification-events`.
