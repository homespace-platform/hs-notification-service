# Email module "Tài khoản & Bảo mật" (category ACCOUNT) - kiểm tra lại 28/11

Chỉ đọc code. Đường dẫn tương đối `D:\Projects\homespace`. NS = hs-notification-service, CORE = hs-core-api (U = `hs-user-service/src/main/java/com/hs/user`, P = `hs-payment-service/src/main/java/com/hs/payment`).

## Kết luận nhanh
- Core phát 6 eventType ACCOUNT (3 tài khoản + 3 KYC), consumer map đủ, KHÔNG có event chết, KHÔNG có event unmapped (DLT).
- **LỖI CHẶN**: `/internal/users/emails` chỉ trả user `active=true` => email "tài khoản bị khóa" sẽ bị bỏ qua (`no-address`). Chi tiết mục 5.
- Chưa có email nào cho ACCOUNT: `NotificationService` chỉ enqueue email cho `SYSTEM/PLATFORM_ANNOUNCEMENT` (`NS/src/modules/notification/application/notification.service.ts:111-114`); template `account/` mới chỉ có README.
- Core sửa 28/11 không đổi module này (writer/trigger giữ nguyên so với báo cáo cũ; đã đối chiếu từng file:line).

## 1. Bảng đầy đủ
| eventType | Khi nào phát (file:line) | Người nhận | Tiêu đề hiện tại | Email? | Lý do |
|---|---|---|---|---|---|
| ACCOUNT_DISABLED | `U/service/impl/UserServiceImpl.java:353-356` (updateUserStatus, chỉ khi `statusChanged`, `:340`; admin tự khóa mình bị chặn `:325`) | Chủ tài khoản bị khóa | Tài khoản đã bị vô hiệu hóa (`NS notification-event.ts:240`, URGENT `:18`) | Có (luôn gửi) | Bảo mật; người dùng không đăng nhập được nên không thấy bell |
| ACCOUNT_ENABLED | `UserServiceImpl.java:353-356` | Chủ tài khoản | Tài khoản đã được kích hoạt lại (`:244`) | Có (luôn gửi) | Xác nhận mở khóa, cũng là cảnh báo nếu không chủ ý |
| ACCOUNT_ROLE_CHANGED | `UserServiceImpl.java:120-123` (admin updateUser, chỉ khi `roleChanged`) | Chủ tài khoản | Quyền truy cập tài khoản đã thay đổi (`:236`) | Có (luôn gửi) | Đổi quyền là sự kiện bảo mật |
| KYC_VERIFIED (VNPT) | `U/service/kyc/VnptKycStore.java:133,137-139` | Chủ KYC | Kết quả xác minh danh tính (`:474`) | Có | Mở khóa chức năng cần KYC |
| KYC_VERIFIED (ADMIN thủ công, 27/11) | `U/service/kyc/AdminKycService.java:75`; writer cho phép ADMIN chỉ với VERIFIED (`U/notification/AccountNotificationWriter.java:68-69`) | Chủ KYC | như trên | Có | Cùng template; người dùng cần biết admin đã xác minh hộ. Không nêu nhà cung cấp/tên admin |
| KYC_REJECTED | `VnptKycStore.java:129,131,137-139` (gồm cả "CCCD đã dùng ở tài khoản khác") | Chủ KYC | Xác minh danh tính chưa được chấp nhận (`:475`) | Có | Cần hành động lại; KHÔNG kèm `rejectionReason` |
| KYC_RETRY_REQUIRED | `VnptKycStore.java:96-100` (bước provider lỗi) và `U/service/kyc/KycRetryNoticeScheduler.java:37` (phiên hết hạn, chỉ user active, `:33`) | Chủ KYC | Cần thực hiện lại xác minh danh tính (`:476`, HIGH `:23`) | Có | Cần hành động. Cả hai đường dùng chung cờ `retryNoticeSentAt` + eventId xác định (`writer:88-89`) => chỉ phát MỘT lần/phiên, báo cáo cũ ghi "nhắc lặp" là SAI, không có nguy cơ spam |
| (không event) cập nhật hồ sơ | `UserServiceImpl.java:286-306` | - | - | Không | Người dùng tự thao tác; riêng đổi email/SĐT/username xem mục 3 |
| (không event) đổi mật khẩu | `UserServiceImpl.java:224-227` | - | - | Gap | Mục 3 |
| (không event) thêm/sửa/xóa/đổi mặc định ngân hàng | `P/service/BankAccountService.java:27,82,109,127` | - | - | Gap | Mục 3 |
| MEMBERSHIP_EXPIRING_SOON/EXPIRED | `AccountNotificationWriter.java:81-84` (category PAYMENT, map `:477`) | Chủ gói | - | Ngoài module | Thuộc module Thanh toán/Gói thành viên, không tính ở đây |

Đếm: 6 eventType Core phát; 0 chết; 0 unmapped. Không bị ảnh hưởng bởi việc bỏ REVIEW / đơn PAID của Gói thành viên (khác module).

## 2. Email "Có"
Chung: layout `renderEmail` category "Tài khoản & Bảo mật"; nút mở `${MAIL_APP_BASE_URL}/settings/account-security` (route cố định, `NS/.../coverage-completion.spec.ts:6`). **Đính kèm: không** (không có PDF nào). Khóa chống trùng: job `notificationId` unique (`email-outbox.ts:51`), Resend `<sourceEventId>:<recipientId>` (`email-delivery.service.ts:135`; không dùng `replace(/^admin_/)` cho ACCOUNT), notification unique `(recipientId, sourceEventId)` (`notification.schema.ts:64`). KYC có sourceEventId xác định (`writer:88`); role/disable/enable dùng `randomUUID` (`writer:47`), outbox retry giữ nguyên eventId nên không trùng.

| Event | Subject | Dòng thông tin | Nút | Mặc định |
|---|---|---|---|---|
| ACCOUNT_DISABLED | `[HomeSpace] [Khẩn cấp] Tài khoản của bạn đã bị vô hiệu hóa` | Trạng thái: Đã vô hiệu hóa; Thời gian (giờ VN, từ occurredAt); Cách xử lý: liên hệ hỗ trợ | "Liên hệ hỗ trợ" (trang/mailto hỗ trợ, cần chốt URL) | LUÔN GỬI |
| ACCOUNT_ENABLED | `[HomeSpace] Tài khoản đã được kích hoạt lại` | Trạng thái: Đang hoạt động; Thời gian | "Đăng nhập" (`/login`, giả định) | LUÔN GỬI |
| ACCOUNT_ROLE_CHANGED | `[HomeSpace] [Quan trọng] Quyền truy cập tài khoản đã thay đổi` | Thời gian; "Do quản trị viên thay đổi"; nhắc liên hệ hỗ trợ nếu không mong đợi | "Xem tài khoản và bảo mật" | LUÔN GỬI |
| KYC_VERIFIED | `[HomeSpace] Xác minh danh tính đã hoàn tất` | Trạng thái: Đã xác minh; Thời gian | "Xem tài khoản" | BẬT (tắt được qua pref ACCOUNT) |
| KYC_REJECTED | `[HomeSpace] [Quan trọng] Xác minh danh tính chưa được chấp nhận` | Trạng thái; Thời gian; hướng dẫn thử lại chung | "Xác minh lại" | BẬT |
| KYC_RETRY_REQUIRED | `[HomeSpace] [Quan trọng] Cần thực hiện lại xác minh danh tính` | Trạng thái: Chưa hoàn tất; Thời gian | "Tiếp tục xác minh" | BẬT |

Cấm đưa vào email: CCCD/số định danh, họ tên, ngày sinh, ảnh giấy tờ, `rejectionReason`, `sessionUrl`, provider (VNPT/ADMIN), tên admin, role cũ/mới, số TK ngân hàng/tên chủ TK, IP/thiết bị, `attemptId` (chỉ làm khóa). Địa chỉ email người nhận không vào log/DLT. Schema NS từ chối field lạ (`coverage-completion.spec.ts:24-29`).

## 3. Thiếu thông báo (Gap)
Không trùng email của Keycloak (xem mục dưới cùng); đánh dấu ưu tiên.
1. **Tài khoản ngân hàng thêm/sửa/xóa/đổi mặc định (CAO, tiền)**: không event. Rủi ro đổi nơi nhận tiền/hoàn cọc. Lưu ý `updateBankAccount` đang `@Transactional(readOnly = true)` nhưng có `save` (`BankAccountService.java:81-82`): có thể không ghi DB (giả định, cần test; ngoài phạm vi báo cáo nhưng phải xử lý trước khi gắn event vào đây). Payment đã có outbox + publisher sẵn (`P/notification/PaymentNotificationOutbox.java`, `PaymentNotificationPublisher.java`) => thêm event `BANK_ACCOUNT_CHANGED` với `data={action: ADDED|UPDATED|DEFAULT_CHANGED|REMOVED}`, không số TK. Email: Có, luôn gửi.
2. **Đổi mật khẩu (CAO, bảo mật)**: `updateUserPassword` chỉ gọi Keycloak (`UserServiceImpl.java:224-227`; `KeycloakUserServiceImpl.java:193-211`). Cách A (chọn): sau khi Keycloak thành công, enqueue `ACCOUNT_PASSWORD_CHANGED` qua writer. Cách B (forward `UPDATE_PASSWORD` từ Keycloak) cần bật `eventsEnabled` (đang `false`, `hs-infra/keycloak/realm-export.json:1706`) + mở rộng provider (hiện chỉ REGISTER/UPDATE_PROFILE/UPDATE_EMAIL/DELETE_ACCOUNT, `KafkaEventPublisherProvider.java:12-16`) => hoãn. Email: Có, luôn gửi.
3. **Admin đổi email/SĐT/username của user (CAO, chiếm tài khoản)**: `updateUser` (`UserServiceImpl.java:100-123`) đổi cả email nhưng chỉ phát event khi đổi role. Người dùng tự đổi qua `updateUserProfile` (`:286-306`) cũng không có event. Cần gửi tới email CŨ => Directory phải trả email trước khi đổi; chốt thiết kế (event mang flag, lookup email tại thời điểm ghi). Pha 2.
4. **Đổi quyền hàng loạt qua Role**: `RoleServiceImpl.updateRole` (`:76-85`) đổi permission cho mọi user thuộc role, không event. TB/thấp, cần quyết định có thông báo từng user hay không (giả định: không).
5. **Đăng nhập thiết bị mới**: không có dữ liệu thiết bị/IP; cần bật Keycloak `LOGIN` + bảng thiết bị. Hoãn.
6. **Xóa tài khoản** (`UserSyncConsumer.java:59`, Keycloak DELETE_ACCOUNT): không event; sau xóa không còn địa chỉ gửi. Không làm.
7. Trùng Keycloak (KHÔNG làm email NS): verify email (`realm-export.json:35`), reset mật khẩu (`:38`), email mời/đặt mật khẩu ban đầu (`KeycloakUserServiceImpl.java:42,251`). Email "đã đổi mật khẩu" của NS chỉ phát từ đường Core (cách A), không phát thêm cho reset để khỏi gửi đôi.

## 4. Việc cần làm
**CORE (trước tiên)**
1. `U/notification/UserEmailLookupService.java:23-30` + `hs-api-service/.../internal/UserInternalController.java:36-41`: thêm tham số `includeInactive` (mặc định false, giữ hành vi broadcast); với true thì bỏ điều kiện `getActive()`, vẫn yêu cầu email không rỗng. Endpoint đã bảo vệ bởi `X-Internal-Secret`.
2. (Pha 1.5) `ACCOUNT_PASSWORD_CHANGED` trong `UserServiceImpl.updateUserPassword` qua `AccountNotificationWriter` (cần `@Transactional` hiện không có; eventId xác định theo thời điểm/`randomUUID` + outbox).
3. `BANK_ACCOUNT_CHANGED` trong payment outbox; sửa `readOnly=true` ở `updateBankAccount` nếu test xác nhận lỗi.
4. Cập nhật docs Kafka. Không đổi writer KYC/role/disable.

**NS**
1. `user-email.directory.ts:19-31`: `resolve(userIds, {includeInactive})` gửi body `{userIds, includeInactive}`; `email-delivery.service.ts:78` tách batch: job `ACCOUNT_DISABLED` gọi với `includeInactive=true`, còn lại giữ false. `content()` (`email-outbox.ts:158-170`) trả thêm `type`, `category`, `occurredAt` (hiện chỉ sourceEventId/title/body/priority).
2. Chính sách theo `(category,type)`: SYSTEM opt-in; `ACCOUNT_*` (+ PASSWORD/BANK sau này) `mandatory` bỏ qua `optedIn` (`email-outbox.ts:173-177`, `email-delivery.service.ts:58-62,115`); KYC theo pref mặc định BẬT (cần migration, reset cũ đặt `email=false`, `mongo-notification-preference.repository.ts:41`; UI ghi "Cảnh báo bảo mật luôn được gửi").
3. Renderer theo type (hiện cứng `renderSystemBroadcastEmail`, `email-delivery.service.ts:128`); thêm `templates/account/index.ts` + hbs; `email.spec.ts` kiểm escape, subject, link, không rò PII.
4. `notification.service.ts:111`: mở điều kiện enqueue cho `category === 'ACCOUNT'` (và các type mới); thêm `ACCOUNT_PASSWORD_CHANGED`, `BANK_ACCOUNT_CHANGED` vào `notification-event.ts` (+ priority, route `/settings/account-security`, spec).
5. Hàng đợi: email bảo mật nên ưu tiên trước broadcast (đang một hàng, `EMAIL_SEND_INTERVAL_MS`).
6. Cập nhật `docs/EMAIL_RESEND.md`, `docs/KAFKA_TESTING.md`; test `npm test -- --runInBand src/modules/notification-delivery src/modules/notification-events`.

**hs-infra**: không cần (chỉ khi chọn cách B).

## 5. Directory và user bị khóa (đã xác minh)
Kết quả: **KHÔNG trả email user bị khóa**. Bằng chứng: `UserEmailLookupService.findActive` lọc `Boolean.TRUE.equals(u.getActive())` (`U/notification/UserEmailLookupService.java:26-28`), comment "unknown or disabled ids are simply absent"; NS ghi chú tương tự (`user-email.directory.ts:10`). `updateUserStatus` đặt `active=false` và enqueue outbox trong cùng transaction (`UserServiceImpl.java:338-356`), nên khi NS xử lý email thì user luôn đã inactive => job bị `skipped/no-address` (`email-delivery.service.ts:107-115`) và KHÔNG retry (trạng thái cuối). Hậu quả: email "tài khoản bị khóa" (bắt buộc theo quyết định chủ sở hữu) sẽ không bao giờ gửi nếu không sửa mục Core 1 + NS 1. `ACCOUNT_ENABLED` không bị ảnh hưởng (user đã active lại). KYC_RETRY của scheduler chỉ cho user active (`KycRetryNoticeScheduler.java:33`), không cần.

## 6. Rủi ro
- PII: `rejectionReason` không bao giờ vào email; giữ spec từ chối field lạ.
- Cho phép lookup user inactive chỉ qua cờ tường minh và chỉ cho `ACCOUNT_DISABLED`; không mở cho broadcast.
- "Luôn gửi" cần chốt nội dung pháp lý (email giao dịch/bảo mật, không phải marketing).
- Admin tự đổi role/status của chính mình bị bỏ qua (`writer:46`), đúng chủ ý.

Chưa kiểm tra: hành vi runtime của `readOnly=true` ở `updateBankAccount`; có luồng self-deactivate nào ngoài admin hay không (không thấy trong U).
