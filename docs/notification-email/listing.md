# Email cho module "Tin đăng cho thuê" (audit, chỉ đọc, chưa sửa code)

Viết tắt: NE = notification-service `src/modules/notification-events/notification-event.ts`; LSS = hs-core-api `hs-listing-service/.../service/ListingStatusService.java`; LS = `ListingService.java`; LNW = `notification/ListingNotificationWriter.java`.

## 1. Bảng sự kiện

Mọi sự kiện LISTING có data chỉ `listingId` + `listingTitle` (+`editId`/`status`), 1 người nhận = chủ tin (LNW enqueue; chủ tin tự thao tác thì bỏ qua: "recipient.equals(actorId) return"). actionPath: `/dashboard/properties/view?id=` (NE:957-958).

| eventType | Trigger | Người nhận | Tiêu đề (NE) | Email? | Vì sao |
|---|---|---|---|---|---|
| LISTING_APPROVED | LSS:154 (`changeByAdmin` PUBLISHED) | chủ tin | "Tin đăng đã được duyệt" (NE:56) | Có | Kết quả duyệt, chủ tin chờ đợi, cần biết tin đã lên |
| LISTING_REJECTED | LSS:155 | chủ tin | "Tin đăng chưa được duyệt" (NE:62) | Có | Cần sửa và gửi lại, hành động bắt buộc |
| LISTING_EDIT_APPROVED | LS:313 | chủ tin | "Chỉnh sửa tin đăng đã được duyệt" (NE:80) | Không | Thấp, mở app thấy ngay; tránh ồn |
| LISTING_EDIT_REJECTED | LS:314 | chủ tin | "Chỉnh sửa ... chưa được duyệt" (NE:86) | Có | Bản sửa bị từ chối, cần xử lý (cùng lý do với REJECTED) |
| LISTING_EXPIRED | LSS:172 (scheduler, actor SYSTEM) và LSS:156 (admin) | chủ tin | "Thời hạn đăng tin đã kết thúc" (NE:98) | Có | Tin ngừng hiển thị, cần gia hạn/đăng lại; mất khách |
| LISTING_STATUS_CHANGED, status=HIDDEN | LSS:157-160 | chủ tin | "Tin đăng đã bị ẩn" (NE:504) | Có | Admin ẩn tin, ảnh hưởng doanh thu chủ tin |
| LISTING_STATUS_CHANGED, status=VIOLATION | LSS:157-160 | chủ tin | "Tin đăng bị đánh dấu vi phạm" (NE:508) | Có | Quan trọng cao, có thể kèm hệ quả tài khoản |
| LISTING_STATUS_CHANGED, status=PENDING_REVIEW | LSS:157-160 (admin đưa về chờ duyệt) | chủ tin | "Tin đăng đang chờ xét duyệt" (NE:500) | Không | Thông tin, không cần hành động |
| LISTING_STATUS_CHANGED, status=RENTED_EXTERNALLY | LSS:157-160 | chủ tin | "...đã cho thuê" (NE:512) | Không | Xác nhận thông tin |
| LISTING_CREATED | LS:155 (admin tạo hộ chủ tin) | chủ tin | NE:68 | Không | Hiếm, chỉ khi actor là admin |
| LISTING_UPDATED | LS:192 (admin sửa) | chủ tin | NE:74 | Không | Ồn, không bắt buộc |
| SAVED_LISTING_UNAVAILABLE / SAVED_LISTING_UPDATED | LSS:375, 388 | người lưu tin (renter) | NE:104, 110 | Không | Số lượng lớn, giá trị thấp; marketing-like |
| MEMBERSHIP_EXPIRING_SOON / MEMBERSHIP_EXPIRED | `MembershipExpiryReminderScheduler.java:28-45` (SOON=3 ngày, dòng 15) qua `AccountNotificationWriter.java:81-84` | chủ gói | NE:473-474, category PAYMENT (NE:797), `/dashboard/membership` | Để module Thanh toán | Không phải LISTING; xem mục 3 |
| Hết quota đăng tin | `MembershipService.java:169` ném `LISTING_QUOTA_EXHAUSTED` | không có | không có event | Chưa có | Chỉ lỗi đồng bộ khi bấm đăng, không có thông báo (mục 3) |
| Gửi duyệt (owner PENDING_REVIEW) | `changeByOwner` LSS:85 | không có | không có | Không | Chủ tin tự làm, không thông báo |

Gom 1 template cho 6 case "Có" (APPROVED, REJECTED, EDIT_REJECTED, EXPIRED, HIDDEN, VIOLATION), khác nhau badge/tiêu đề/đoạn văn. Email chỉ gửi qua category LISTING.

## 2. Chi tiết các email "Có"

Chung: CTA `MAIL_APP_BASE_URL` + `/dashboard/properties/view?id=<listingId>` (encodeURIComponent, NE:958). Idempotency key = `<sourceEventId>:<recipientId>` (hiện email SYSTEM: `email-delivery.service.ts:135`; bảng job unique theo `notificationId`, `email-outbox.ts:31`). `sourceEventId` = `eventId` UUID ngẫu nhiên của producer (LNW), mỗi sự kiện duy nhất; Kafka phát lại thì cùng eventId nên không trùng. Mặc định: opt-in tắt cho LISTING (xem rủi ro 1). Footer: link `/settings` cài đặt thông báo.

| Event | Subject | Hàng chi tiết | Badge | Dữ liệu loại trừ |
|---|---|---|---|---|
| LISTING_APPROVED | "Tin đăng của bạn đã được duyệt" | Tin đăng (listingTitle), Trạng thái: Đang hiển thị | primary | giá, địa chỉ, ảnh, SĐT, lý do nội bộ |
| LISTING_REJECTED | "Tin đăng chưa được duyệt, cần chỉnh sửa" | Tin đăng, Trạng thái: Chưa được duyệt | warning | lý do từ chối (không có trong event; CTA dẫn tới trang tin xem lý do) |
| LISTING_EDIT_REJECTED | "Chỉnh sửa tin đăng chưa được duyệt" | Tin đăng, Mã chỉnh sửa không hiển thị | warning | `editId`, nội dung bản sửa, lý do |
| LISTING_EXPIRED | "Tin đăng đã hết thời hạn hiển thị" | Tin đăng, Trạng thái: Hết hạn | warning | ngày hết hạn chính xác (chưa có trong event), thông tin gói/giá |
| HIDDEN | "Tin đăng của bạn đã bị ẩn" | Tin đăng, Trạng thái: Đã ẩn | warning | lý do admin, tên admin |
| VIOLATION | "Tin đăng bị đánh dấu vi phạm" | Tin đăng, Trạng thái: Vi phạm | danger | lý do chi tiết, tên admin, hồ sơ khác |

Không đưa vào email: userId/ownerId, địa chỉ email, nội dung mô tả tin, tên admin, `reason` (LSS:129-131 có lý do nhưng event không mang; giữ nguyên, cấm thêm vào payload), gợi ý "bị phạt" kiểu tài chính.

## 3. Khoảng trống

1. **Tin sắp hết hạn: KHÔNG có.** `ListingExpirationScheduler.java:16-18` (`listing.expiration-check-delay-ms=60000`, application.properties:232) chỉ gọi `expirePublishedListings` (LSS:165-175) khi đã quá hạn. Không có event `LISTING_EXPIRING_SOON`, không có cột/cờ đã nhắc. Đây là email có giá trị cao nhất còn thiếu. Mẫu để theo: `MembershipExpiryReminderScheduler` (khoảng SOON 3 ngày, `setExpiryReminderFor` đánh dấu đã nhắc, eventId xác định theo `type:recipient:expiry` ở `AccountNotificationWriter.java:88`).
2. **Hết quota đăng tin:** chỉ lỗi `LISTING_QUOTA_EXHAUSTED` (MembershipService.java:169), không có thông báo bất đồng bộ; không cần email vì người dùng đang thao tác trực tiếp.
3. **Membership:** MEMBERSHIP_EXPIRING_SOON/EXPIRED thuộc PAYMENT (NE:797), không thuộc LISTING; thuộc audit module Thanh toán. Email gói hết hạn quan trọng vì kéo theo không đăng được tin mới; nên làm cùng PAYMENT. Quota (`quotaResetsAt`, `addonRemaining`) không có event.
4. Tin chuyển RESERVED/RENTED/PUBLISHED lại (LSS:210-250) không có thông báo (thuộc luồng hợp đồng/thuê).
5. LISTING_EXPIRED dùng chung cho tin hết hạn lúc đang chờ duyệt (LSS:167 `findPendingReviewsPastPublicationExpiry`), email nên viết trung lập.

## 4. Thay đổi cần làm, rủi ro, checklist

Thay đổi:
- Hiện chỉ `SYSTEM + PLATFORM_ANNOUNCEMENT` tạo email (`notification.service.ts:112`); mở rộng thành bộ lọc theo `eventType` cho LISTING (và status HIDDEN/VIOLATION).
- Hiện renderer/`content()` chỉ phục vụ broadcast (`email-delivery.service.ts:128`, `EmailContent` ở `email-outbox.ts:21-26` có `priority`). Cần thêm nhánh theo category/`type`, thêm `type`, `listingTitle`, `status` vào `content()`; không đọc `actionPath` tự do, tự dựng từ `metadata.listingId`.
- Thêm `templates/listing/listing-status.hbs` + `index.ts`, cập nhật README listing; test ở `email/email.spec.ts` (escape listingTitle, link, tiêu đề).
- Producer (hs-core-api): thêm `LISTING_EXPIRING_SOON` (scheduler + cờ đã nhắc) vào LNW, `templates` NE, `listingExtraKey`, docs/KAFKA_TESTING.md.

Rủi ro:
1. `withDefaults` (`notification.service.ts:221`): `email: item?.email ?? category !== 'SYSTEM'` mặc định BẬT cho LISTING, và `optedIn` = "chỉ true tường minh" (outbox.ts:35). Phải chốt: email LISTING mặc định tắt (opt-in) hay bật; nếu bật cần migration/reset tương tự SYSTEM, vì dữ liệu cũ `email=true` không phải đồng ý.
2. Throttle Resend 2 req/giây (`EMAIL_SEND_INTERVAL_MS=500`): lô tin hết hạn cùng lúc có thể dồn hàng, chấp nhận được vì dispatcher bền.
3. `listingTitle` do người dùng nhập (đã lọc `<>`/ký tự điều khiển, cắt 120 ở LNW) nhưng email phải vẫn escape `{{x}}`; không dùng `{{{`.
4. Event v1 hiện không có lý do từ chối; đừng thêm lý do vào Kafka khi chưa có quyết định riêng (rò rỉ dữ liệu kiểm duyệt).
5. Mất đồng bộ: nếu thêm EXPIRING_SOON mà dùng eventId ngẫu nhiên thì lặp mỗi giờ; phải eventId xác định theo `listingId + expiresAt`.

Checklist theo thứ tự:
1. Chốt mặc định opt-in LISTING và danh sách 6 case "Có" với owner.
2. Mở rộng `EmailOutbox.content()` + dispatcher để chọn template theo category/type.
3. Viết template listing + test render.
4. Mở bộ lọc enqueue ở `notification.service.ts:112` (LISTING + status HIDDEN/VIOLATION) kèm test: opt-out không tạo job, trùng eventId không tạo job thứ hai.
5. Reset/migration cờ email LISTING nếu chọn opt-in.
6. Producer: `LISTING_EXPIRING_SOON` + test, rồi bật template tương ứng.
7. Cập nhật docs/EMAIL_RESEND.md, `mail:preview`, thử gửi qua Resend thật trên domain đã verify.
