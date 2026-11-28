# Email cho "Tin đăng" + "Tin tức" + "Hệ thống" (audit lại 28/11/2026, chỉ đọc, chưa sửa code)

Viết tắt: NE = notification-service `src/modules/notification-events/notification-event.ts`; LSS = hs-core-api `hs-listing-service/.../service/ListingStatusService.java`; LS = `service/ListingService.java`; LNW = `notification/ListingNotificationWriter.java`; BNS = `hs-user-service/.../notification/BroadcastNotificationService.java`; BNP = `BroadcastNotificationPublisher.java`.
Kết quả kiểm lại: 10 eventType LISTING + 1 NEWS + 5 SYSTEM đều có producer và đều được consumer map; không có sự kiện chết, không có sự kiện bị DLT. Danh sách sự kiện Tin đăng không đổi so với bản cũ; chỉ đổi số dòng NE và tên file scheduler.

## 1. Bảng đầy đủ

Mọi sự kiện LISTING: data chỉ `listingId` + `listingTitle` (+`editId`/`status`), 1 người nhận = chủ tin; chủ tin tự thao tác thì bỏ qua (LNW:61). actionPath `/dashboard/properties/view?id=` (NE:963-965). Không có lý do duyệt/từ chối trong event (LNW:64-69).

| eventType | Khi nào phát | Người nhận | Tiêu đề hiện tại (NE) | Email? | Lý do |
|---|---|---|---|---|---|
| LISTING_APPROVED | LSS:154 (`changeByAdmin` -> PUBLISHED) | chủ tin | "Tin đăng đã được duyệt" (56) | Có | Kết quả chủ tin chờ, cần biết tin đã lên |
| LISTING_REJECTED | LSS:155 | chủ tin | "Tin đăng chưa được duyệt" (62) | Có | Hành động bắt buộc: sửa và gửi lại |
| LISTING_EDIT_APPROVED | LS:312-314 (`decideEdit`) | chủ tin | "Chỉnh sửa tin đăng đã được duyệt" (80) | Không | Thấp, mở app thấy ngay |
| LISTING_EDIT_REJECTED | LS:312-314 | chủ tin | "Chỉnh sửa ... chưa được duyệt" (86) | Có | Bản sửa bị từ chối, cần xử lý |
| LISTING_EXPIRED | LSS:172 (scheduler, actor SYSTEM) và LSS:156 (admin) | chủ tin | "Thời hạn đăng tin đã kết thúc" (98) | Có | Tin ngừng hiển thị, cần gia hạn/đăng lại |
| LISTING_STATUS_CHANGED = HIDDEN | LSS:157-160 | chủ tin | "Tin đăng đã bị ẩn" (510) | Có | Admin ẩn tin, ảnh hưởng doanh thu |
| LISTING_STATUS_CHANGED = VIOLATION | LSS:157-160 | chủ tin | "Tin đăng bị đánh dấu vi phạm" (514) | Có | Mức cao, tin bị khoá (`LISTING_LOCKED_BY_VIOLATION`, LSS:87), bản sửa đang chờ bị huỷ (LSS:146-148) |
| LISTING_STATUS_CHANGED = PENDING_REVIEW | LSS:157-160 | chủ tin | "Tin đăng đang chờ xét duyệt" (506) | Không | Thông tin, không cần hành động |
| LISTING_STATUS_CHANGED = RENTED_EXTERNALLY | LSS:157-160 | chủ tin | "...đã được ghi nhận đã cho thuê" (518) | Không | Xác nhận thông tin |
| LISTING_CREATED | LS:155 (`createByAdmin`) | chủ tin | "Tin đăng đã được tạo" (68) | Không | Hiếm, chỉ admin tạo hộ |
| LISTING_UPDATED | LS:192 (`updateByAdmin`) | chủ tin | "Tin đăng đã được cập nhật" (74) | Không | Ồn, mỗi lần admin lưu đều phát |
| SAVED_LISTING_UNAVAILABLE | LSS:375 (PUBLISHED -> không còn công khai, gồm cả RESERVED) | người lưu tin | "Tin đã lưu ngừng hiển thị" (104) | Không | Số lượng lớn, giá trị thấp, giống marketing |
| SAVED_LISTING_UPDATED | LSS:388 (admin sửa/duyệt bản sửa, tin PUBLISHED) | người lưu tin | "Tin đã lưu có cập nhật" (110) | Không | Như trên; fanout theo số người lưu |
| NEWS_PUBLISHED | news-service `news-publication.publisher.ts:79-85` -> Core `BNS:51-55` -> BNP (RECIPIENTS_SQL: user active, role USER/ADMIN) | mọi user active, chunk 100 | "Tin tức mới" (NE:831-834), `/news/<slug>` | Không | Gửi hàng loạt cho toàn bộ user = thư quảng bá; chỉ in-app + push (xem mục 2) |
| PLATFORM_ANNOUNCEMENT | `NotificationBroadcastController` -> `BNS:42-48` (admin có quyền NOTIFICATION_BROADCAST) | mọi user active | title/body do admin nhập (NE:848-856) | Có (ĐÃ làm) | Email SYSTEM có sẵn: `notification.service.ts:112`, `email-delivery.service.ts:129` |
| SYSTEM_INCIDENT_OPENED | `OperationalIncidentService.java:36` (gọi từ `OperationalHealthMonitor:37` GATEWAY sau 3 lần lỗi; `ContractDocumentProofWorker:194` BLOCKCHAIN) | chỉ admin (`ComplaintAdminAudienceRepository`) | "Hệ thống có sự cố cần kiểm tra" (NE:496), URGENT | Có (đề xuất) | Cảnh báo vận hành cho admin; xem mục 2 về bão email |
| SYSTEM_INCIDENT_RESOLVED | cùng chỗ, `failing=false` | admin | "Sự cố hệ thống đã phục hồi" (NE:497) | Không | In-app là đủ |
| ROLE_PERMISSIONS_CHANGED | `RoleServiceImpl:95` -> `BNS:59-64`, người nhận = user của role đó (`ROLE_RECIPIENTS_SQL`) | user của role | "Quyền sử dụng tính năng đã thay đổi" (NE:838-846) | Không | Tín hiệu làm mới quyền theo thời gian thực, nhiều người, in-app |
| BRANCH_DAILY_DIGEST | `BranchDigestScheduler:35` (8h sáng, Asia/Ho_Chi_Minh) -> `BranchDigestOutboxWriter:49` | chủ chi nhánh | "Việc cần chú ý hôm nay" (NE:815-823) | Không (để sau) | Đã là bản tóm tắt; không phải mục tiêu đợt này |

Hết quota đăng tin và gửi duyệt của chủ tin: không có event (mục 3). `MEMBERSHIP_EXPIRING_SOON/EXPIRED` thuộc category PAYMENT (NE:801-803), thuộc audit module Thanh toán, không tính ở đây.

## 2. Email "Có"

Chung: CTA `MAIL_APP_BASE_URL` + `/dashboard/properties/view?id=<listingId>` (encodeURIComponent; tự dựng từ `metadata.listingId`, không đọc `actionPath` tự do). Không đính kèm file. Khoá chống trùng: `<sourceEventId>:<recipientId>` làm idempotencyKey gửi Resend (`email-delivery.service.ts:135`) và job outbox duy nhất theo `notificationId` (`email-outbox.ts:59` unique). `sourceEventId` = `eventId` UUID ngẫu nhiên mỗi sự kiện (LNW:62), Kafka phát lại thì cùng eventId nên không trùng. Footer: link `/settings`.
Mặc định: BẬT, người dùng tắt được (giả định, cần chốt). Lý do: LISTING hiện mặc định email=true (`notification.service.ts:221`), là thư giao dịch về tin của chính họ. LUÔN GỬI chỉ áp dụng cho bảo mật (module Tài khoản), không áp cho tin đăng.

| Event | Subject | Hàng thông tin | Badge | Không đưa vào |
|---|---|---|---|---|
| LISTING_APPROVED | "Tin đăng của bạn đã được duyệt" | Tin đăng (listingTitle), Trạng thái: Đang hiển thị | primary | giá, địa chỉ, ảnh, SĐT |
| LISTING_REJECTED | "Tin đăng chưa được duyệt, cần chỉnh sửa" | Tin đăng, Trạng thái: Chưa được duyệt | warning | lý do (không có trong event); nút dẫn tới tin để xem |
| LISTING_EDIT_REJECTED | "Chỉnh sửa tin đăng chưa được duyệt" | Tin đăng | warning | `editId`, nội dung bản sửa |
| LISTING_EXPIRED | "Tin đăng đã hết thời hạn hiển thị" | Tin đăng, Trạng thái: Hết hạn | warning | ngày hết hạn (event không có); viết trung lập vì dùng chung cho tin hết hạn lúc chờ duyệt (LSS:167) |
| HIDDEN | "Tin đăng của bạn đã bị ẩn" | Tin đăng, Trạng thái: Đã ẩn | warning | lý do admin, tên admin |
| VIOLATION | "Tin đăng bị đánh dấu vi phạm" | Tin đăng, Trạng thái: Vi phạm | danger | lý do, tên admin, hồ sơ khác |

Gom 1 template `templates/listing/listing-status.hbs` cho 6 case (khác badge/tiêu đề/đoạn văn). Dữ liệu cấm thêm vào payload: lý do kiểm duyệt (rò rỉ dữ liệu kiểm duyệt), userId, email.

SYSTEM_INCIDENT_OPENED (đề xuất, cần chủ chốt): subject "Cảnh báo hệ thống: <component>"; hàng: Thành phần (BLOCKCHAIN/GATEWAY), Thời điểm; nút `/operations/system-alerts?incidentId=` ở **admin portal**, không phải `MAIL_APP_BASE_URL` của web-app, nên cần thêm biến base URL admin (giả định: admin portal là app riêng, `hs-admin-portal` có route system-alerts). Mặc định: chỉ gửi cho admin, theo opt-in SYSTEM (tắt) trừ khi chủ chốt "luôn gửi cho admin". Khoá chống trùng: `eventId` (UUID mỗi incident x admin). Rủi ro bão email: `sourceKey="proof:"+documentId` (ContractDocumentProofWorker:194) tạo 1 incident mỗi tài liệu; blockchain chết có thể sinh hàng loạt email cho mỗi admin; nên chỉ gửi email cho GATEWAY hoặc gộp theo component/giờ.

NEWS_PUBLISHED: giữ KHÔNG email. Lý do: toàn bộ user, nội dung chung, là thư quảng bá; NEWS email preference hiện lưu nhưng không gửi (checklist NEWS_NOTIFICATIONS.md); nếu sau này bật cần đồng ý riêng và liên kết huỷ đăng ký. PLATFORM_ANNOUNCEMENT: đã gửi email, opt-in, không cần làm thêm.

## 3. Thiếu thông báo

1. **Tin sắp hết hạn: KHÔNG có (đã kiểm lại).** `service/ListingExpirationScheduler.java:16-18` (`listing.expiration-check-delay-ms=60000`, application.properties:232) chỉ gọi `expirePublishedListings` (LSS:165-175) khi đã quá hạn; `Listing.expiresAt` (Listing.java:69) có nhưng không có cờ đã nhắc. Giá trị cao nhất còn thiếu (chủ tin mất lượt đăng và khách). Mẫu: `MembershipExpiryReminderScheduler.java:50` (`setExpiryReminderFor`), eventId xác định.
2. **Hết quota đăng tin:** chỉ lỗi đồng bộ `LISTING_QUOTA_EXHAUSTED` (ListingErrorCode:20) ném ở `MembershipService.java:170` khi chủ tin bấm gửi duyệt; không có event. Category nếu làm: PAYMENT (gói/lượt đăng), không phải LISTING. Không cần email (người dùng đang thao tác, thấy lỗi ngay); in-app "hết lượt" là tuỳ chọn.
3. **Admin không được báo khi có tin/bản sửa mới chờ duyệt:** chủ tin gửi duyệt (LSS:75, `changeByOwner`) không phát event cho người duyệt; chỉ làm việc qua hàng đợi (giả định có màn hình hàng đợi). In-app cho moderator là nice-to-have, không email.
4. **Lý do từ chối/ẩn/vi phạm không đến chủ tin qua thông báo:** admin bắt buộc nhập lý do (LSS:127-130 `MODERATION_REASON_REQUIRED`) nhưng event không mang; email chỉ dẫn tới tin (giả định trang tin hiển thị lý do, chưa kiểm web).
5. **Sự cố chỉ có 2 thành phần:** `Set.of("BLOCKCHAIN","GATEWAY")` (OperationalIncidentService.java:25); không có cảnh báo cho Kafka, MongoDB, Gotenberg/S3, Resend lỗi gửi thư; không thông báo cho admin khi email bị `failed` nhiều lần.
6. **Tin tức:** không có thông báo "tin tức cập nhật/gỡ"; chấp nhận được.
7. Tin chuyển RESERVED/RENTED/PUBLISHED lại (LSS:210-250): không có thông báo, thuộc luồng hợp đồng/thuê.

## 4. Việc cần làm

notification-service (theo thứ tự):
1. Chốt mặc định LISTING (BẬT/TẮT) và danh sách 6 case "Có" + SYSTEM_INCIDENT_OPENED với chủ chốt.
2. Mở rộng `EmailOutbox.content()`/dispatcher (`email-outbox.ts:21-26`, `email-delivery.service.ts:129`) để chọn template theo category/type, thêm `type`, `listingTitle`, `status`, `metadata.listingId`.
3. Mở `optedIn` (`email-outbox.ts:35,176` chỉ đọc category SYSTEM) theo category của notification; nếu chọn mặc định tắt cho LISTING thì sửa `withDefaults` (`notification.service.ts:221`) và migration cờ email cũ (`email=true` không phải đồng ý).
4. Template `templates/listing/listing-status.hbs` + `index.ts`, xoá/cập nhật `listing/README.md`; test `email.spec.ts` (escape listingTitle `{{x}}` không dùng `{{{`, link, subject).
5. Mở bộ lọc enqueue `notification.service.ts:112` (hiện chỉ `SYSTEM + PLATFORM_ANNOUNCEMENT`) thành bảng allow-list theo `type` (+ status HIDDEN/VIOLATION); test: opt-out không tạo job, trùng eventId không tạo job thứ hai.
6. Template cảnh báo sự cố (admin) + biến base URL admin portal + gộp/giới hạn theo component; test render.
7. Cập nhật `docs/EMAIL_RESEND.md`, `mail:preview`; thử gửi thật qua Resend trên domain đã verify.

hs-core-api (thứ tự):
1. `LISTING_EXPIRING_SOON`: cột cờ đã nhắc trên `Listing`, scheduler nhắc trước N ngày (giả định 3 ngày như membership), thêm vào enum LNW:26-29 và eventId xác định theo `listingId + expiresAt` (tránh lặp mỗi giờ); đồng thời thêm template NE (`templates`, `listingExtraKey`) và docs/KAFKA_TESTING.md.
2. (Tuỳ chọn) event cho moderator khi có tin/bản sửa chờ duyệt; event in-app cho hết quota (category PAYMENT).
3. Giới hạn/gộp incident `BLOCKCHAIN` theo thành phần để tránh bão thông báo/email; cân nhắc thêm thành phần khác vào `Set.of(...)`.
4. Không thêm lý do kiểm duyệt vào payload Kafka khi chưa có quyết định riêng.

Rủi ro chung: Resend throttle 2 req/giây (`EMAIL_SEND_INTERVAL_MS=500`): lô tin hết hạn cùng lúc dồn hàng, chấp nhận được vì dispatcher bền.
