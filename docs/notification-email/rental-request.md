# Email cho module "Yêu cầu thuê" (RENTAL_REQUEST) - kế hoạch

Chỉ kế hoạch, chưa sửa code. Đường dẫn ngắn: `LS` = `hs-core-api/hs-listing-service/src/main/java/com/hs/listing/service/RentalRequestService.java`, `OB` = `hs-core-api/hs-contract-service/src/main/java/com/hs/contract/service/RentalOnboardingService.java`, `PR` = `.../PreTenancyResolutionService.java`, `NE` = `hs-notification-service/src/modules/notification-events/notification-event.ts`.

## 0. Hiện trạng (bằng chứng)
- Producer: `RentalRequestNotificationWriter.java:25-35` (26 eventType, `Side` OWNER/RENTER), ghi outbox rồi Kafka. Payload chỉ có `requestId, recipientSide, listingTitle` (`:62-69`; javadoc `:19-20`: không có lý do, tiền, tên, ngày, URL). Người nhận = `recipients[userId]`, không có email.
- Consumer: tiêu đề/nội dung cố định ở `NE:30-55`, CTA/actionPath chưa có cho rental thường (khiếu nại dùng `/dashboard/complaints?...` `NE:803`), category `RENTAL_REQUEST` `NE:27`.
- Email chỉ gắn cho `SYSTEM` + `PLATFORM_ANNOUNCEMENT`: `notification.service.ts:112-114`; `EmailDeliveryService.enqueue` (`email-delivery.service.ts:58-62`) chỉ kiểm tra opt-in; `process` luôn gọi `renderSystemBroadcastEmail` (`:129-136`), idempotency key `<broadcastId>:<userId>` (`:135`) -> phải tổng quát hóa.
- Mặc định email: SYSTEM tắt, reset một lần bằng `emailOptInReset` (`mongo-notification-preference.repository.ts:27-41`). Thư mục mẫu `templates/rental-request/README.md` đang rỗng. Địa chỉ email lấy qua `user-email.directory.ts` (Core `/internal/users/emails`), không đưa vào Kafka.
- Hạn: `rental.response-hours=24` (`LS:262` set `respondBy`), `rental.hold-duration-minutes=60` (`LS:322-325` set `holdExpiresAt`), `rental.first-rent-window-hours=24`, `rental.start-change-response-hours=24`, `rental.default-response-hours=24`, `rental.resolution-response-hours=48` (`application.properties:247-261,269`). Quá hạn: `RentalHoldExpirationScheduler` -> `LS:566-626`; onboarding `OB:772` (30s).

## 1. Bảng sự kiện
Cột "Email": Có / Không / Gộp (gộp vào email khác hoặc chỉ gửi khi có điều kiện). Tiêu đề lấy từ `NE:30-55`. Người nhận: O = chủ nhà, R = người thuê.

| eventType | trigger | người nhận | tiêu đề | Email | lý do |
|---|---|---|---|---|---|
| RENTAL_REQUEST_SUBMITTED | `LS:266` | O | Yêu cầu thuê đã được gửi | Có | Chủ nhà phải phản hồi trong 24h, mất hạn là hủy |
| RENTAL_REQUEST_ACCEPTED | `LS:357` | R | Yêu cầu thuê đã được chấp nhận | Có | Mở giữ chỗ 60 phút, cần hành động ngay |
| RENTAL_REQUEST_REJECTED | `LS:402` | R | Yêu cầu thuê bị từ chối | Có | Kết quả quyết định, người thuê đang chờ |
| RENTAL_REQUEST_AUTO_REJECTED | `LS:359` | R | Yêu cầu thuê không được chọn | Không | Hệ quả của người khác được chọn, push đủ (nhưng nên gộp nếu bật "kết quả") |
| RENTAL_REQUEST_CANCELLED | `LS:440`, `OB:451`, `OB:514`, `PR:199` | O hoặc R (bên còn lại) | Yêu cầu thuê đã bị hủy | Có | Trạng thái cuối, người kia cần biết, ít xảy ra |
| RENTAL_REQUEST_EXPIRED | `LS:592` (SYSTEM) | O+R | Yêu cầu thuê hết hạn phản hồi | Có | Kết quả của hạn 24h, phải báo cả hai |
| RENTAL_HOLD_EXPIRED | `LS:626` | O+R | Thời gian giữ chỗ đã hết | Có | Mất giữ chỗ, phòng quay lại PUBLISHED |
| RENTAL_CANCELLATION_REQUESTED | `OB:479`, `PR:53` | bên kia | Có yêu cầu hủy thuê | Có | Cần phản hồi, có hạn 48h |
| RENTAL_CANCELLATION_REFUND_PENDING | `OB:514`, `PR:164` | R/O | Hủy thuê đang chờ hoàn tiền | Có | Liên quan tiền, chưa hoàn tất, cần theo dõi |
| RENTAL_CANCELLATION_REJECTED | `OB:513`, `PR:69` | bên đề nghị | Yêu cầu hủy thuê bị từ chối | Gộp | Gộp vào email kết quả hủy (cùng template, nội dung theo kết quả) |
| RENTAL_CANCELLATION_WITHDRAWN | `PR:68` | bên kia | Yêu cầu hủy thuê đã được rút lại | Không | Thông tin phụ, push đủ |
| RENTAL_CANCELLATION_DISPUTED | `PR:73` | bên kia | Yêu cầu hủy thuê bị phản đối | Có | Chuyển sang xử lý tranh chấp |
| RENTAL_START_CHANGE_REQUESTED | `OB:349` | O | Có yêu cầu đổi ngày bắt đầu thuê | Có | Hạn 24h, ảnh hưởng hợp đồng |
| RENTAL_START_CHANGE_APPROVED / REJECTED | `OB:393` | R | Đổi ngày ... được chấp nhận / bị từ chối | Có (1 template, 2 biến thể) | Kết quả quyết định |
| RENTAL_START_CHANGE_WITHDRAWN | `OB:401` | O | ... đã được rút lại | Không | Phụ |
| RENTAL_START_CHANGE_EXPIRED | `OB:206` (SYSTEM) | O+R | ... đã hết hạn | Không | Hệ quả hết hạn đã tự phục hồi, push đủ |
| RENTAL_SIGNING_WINDOW_REOPENED | `OB:527` | R | Thời gian ký hợp đồng được mở lại | Có | Có hạn mới, cần hành động |
| RENTAL_HOLD_EXTENDED | `OB:542`, `OB:745` | R (hoặc O+R, SYSTEM) | Thời gian giữ chỗ được gia hạn | Có | `OB:745` là hạn cuối thanh toán tháng đầu sau cảnh báo, rất quan trọng |
| RENTAL_DEFAULT_NOTICE_ISSUED | `OB:653` | bên kia | Có thông báo về yêu cầu thuê | Có | Priority HIGH (`NE:23`), có hạn xử lý, tiền cọc |
| RENTAL_DEFAULT_DISPUTED | `OB:661` | O | Thông báo ... bị phản đối | Có | Pháp lý/tiền cọc |
| RENTAL_REQUEST_CANCELLED_BY_SYSTEM | `OB:696`, `OB:759` | O+R | Yêu cầu thuê bị hủy bởi hệ thống | Có | Kết quả cuối do quá hạn, mất giữ chỗ |
| RENTAL_RESUME_REQUESTED | `PR:94` | bên kia | Có yêu cầu tiếp tục thuê | Có | Cần phản hồi |
| RENTAL_RESUMED | `PR:103` | bên kia | Yêu cầu thuê đã được tiếp tục | Gộp | Gộp vào kết quả resume cùng REJECTED |
| RENTAL_RESUME_REJECTED | `PR:109` | bên đề nghị | ... bị từ chối | Gộp | như trên |
| RENTAL_RESUME_WITHDRAWN | `PR:109` | bên kia | ... đã được rút lại | Không | Phụ |

Ngoài phạm vi bảng: cùng category còn 4 loại khiếu nại (`NE:800-806`, spec `coverage-completion.spec.ts:12`) và các bước xác nhận cọc/thanh toán (không thấy event riêng trong writer này, nằm ở nhóm PAYMENT), xem mục 3.

## 2. Chi tiết cho các sự kiện "Có"
Quy ước chung: tiêu đề `[HomeSpace] <title>` (+ `[Quan trọng]` cho nhóm hạn/tiền); hàng chi tiết: Tin đăng (`listingTitle`, đã làm sạch `Writer:65-69`), Mã yêu cầu rút gọn (8 ký tự đầu `requestId`), Vai trò của bạn; CTA "Mở yêu cầu thuê" = `MAIL_APP_BASE_URL` + path. Path chủ nhà: `/dashboard/rental-requests?requestId=<id>` (đã dùng ở `BranchOverviewService.java:589`); path người thuê: cần chốt theo web client (cùng trang detail đã duyệt, `/dashboard/rental-requests/<id>`), không đoán trong code, phải xác nhận với hs-client-portal. Idempotency key chung: `rental:<eventId>:<recipientId>` (eventId UUID sinh ở `Writer:60`, đảm bảo phát lại Kafka không gửi lại). Không đưa vào email: số điện thoại, CCCD/giấy tờ, tên đầy đủ đối phương, lý do hủy/từ chối (nhạy cảm), số tài khoản, số tiền chi tiết (chỉ ghi "xem trong ứng dụng").

| Nhóm | Subject | Hàng thêm | Mặc định |
|---|---|---|---|
| SUBMITTED (O) | "Có yêu cầu thuê mới cần phản hồi trong 24 giờ" | Hạn phản hồi (cần `respondBy`) | BẬT sau khi người dùng bật Email của mục |
| ACCEPTED (R) | "Chủ nhà đã chấp nhận, giữ chỗ tới <giờ>" | Hạn giữ chỗ (`holdExpiresAt`), bước tiếp theo | như trên |
| REJECTED / CANCELLED / EXPIRED / HOLD_EXPIRED / CANCELLED_BY_SYSTEM | tiêu đề theo `NE` | Kết quả cuối, phòng đã được thả | như trên |
| CANCELLATION_REQUESTED / REFUND_PENDING / DISPUTED / RESUME_REQUESTED / START_CHANGE_REQUESTED | tiêu đề theo `NE` + "cần phản hồi" | Hạn phản hồi (24h hoặc 48h) | như trên |
| SIGNING_WINDOW_REOPENED / HOLD_EXTENDED / DEFAULT_NOTICE / DEFAULT_DISPUTED | `[Quan trọng]` + tiêu đề | Hạn mới, nêu rõ "hợp đồng chưa được ký" | như trên |

Mặc định: giữ nguyên nguyên tắc hiện tại, cờ `email` của mục RENTAL_REQUEST mặc định TẮT (opt-in), không tự bật cho dữ liệu cũ (cần mở rộng `emailOptInReset` cho mục này, hiện chỉ reset SYSTEM, `mongo-notification-preference.repository.ts:41`). Không phân biệt "BẬT/TẮT" từng event, vì cờ chỉ theo category (`notification.model.ts:71`).

## 3. Lỗ hổng
1. Không có nhắc "sắp hết hạn" nào cho rental request. Chỉ có `AgreementSigningReminderScheduler.java:54` (hợp đồng, 24h trước hạn ký) và nhắc lịch hẹn `AppointmentReminderScheduler`. Cần thêm: (a) chủ nhà, `PENDING` còn <=6h tới `respondBy`; (b) người thuê, `ACCEPTED` còn <=15 phút tới `holdExpiresAt` (hold chỉ 60 phút); (c) người thuê, hạn thanh toán tháng đầu `first-rent-window-hours`/hạn cuối `OB:741-745` còn <=6h; (d) bên nhận yêu cầu hủy/đổi ngày/resume còn <=6h.
2. Payload không có `respondBy/holdExpiresAt/dueAt`, nên email không nêu được hạn: `Writer:19-20`, validator Kafka phía notification-service kiểm tra tập khóa chặt (`NE:722`).
3. Event nhắc mới (vd `RENTAL_REQUEST_RESPONSE_DUE_SOON`, `RENTAL_HOLD_EXPIRING_SOON`, `RENTAL_FIRST_RENT_DUE_SOON`) chưa có trong enum `Writer:25-35` hay `rental-request-notification.spec.ts:13-21`.
4. Bước xác nhận cọc/thanh toán trước hợp đồng: không có event RENTAL_* riêng, cần xác nhận với PAYMENT module (category PAYMENT, nằm ngoài tài liệu này) để tránh email trùng.
5. `RENTAL_REQUEST_AUTO_REJECTED` và các sự kiện "Không" vẫn chỉ push/in-app, chấp nhận.

## 4. Thay đổi theo repo
hs-core-api (listing + contract):
- Thêm 3 event nhắc + scheduler (theo mẫu `AppointmentReminderScheduler`: `@Scheduled`, khóa dòng, cột đánh dấu đã nhắc để không lặp, `findByIdForUpdate`); cần cột mới `*_reminded_at` + migration (nhóm `*SchemaMigration`).
- Mở rộng `data` của writer: thêm `deadlineAt` (ISO instant) chỉ cho các event có hạn; cập nhật javadoc `Writer:19-20` và test `RentalWorkflowPostgresTest.java:220,533,546,911` (so khớp danh sách event).
- Không đổi enum cũ (giữ tương thích outbox đang chờ).

hs-notification-service:
- Cho phép `data.deadlineAt` tùy chọn trong parse rental, trả `actionPath` cho từng event, thêm tiêu đề cho 3 event mới (`NE:30-55`).
- Tổng quát hóa `EmailDeliveryService`: bỏ điều kiện `SYSTEM` (`notification.service.ts:112`), chọn template theo category/eventType (hiện cứng `renderSystemBroadcastEmail` `:129`), idempotency key theo mục 2, bảng cho phép (whitelist eventType có email, tập "Có" ở mục 1).
- Template `templates/rental-request/*.hbs` + `index.ts` (xóa README), test cạnh `email.spec.ts` (escape, subject, link, thiếu `deadlineAt`).
- Mở rộng reset opt-in cho `RENTAL_REQUEST`; bật tùy chọn "Email" của mục này trong UI Cài đặt (đang "Sắp có", `EMAIL_RESEND.md`).

Rủi ro:
- Spam: một request sinh nhiều email (submit, accept, expire...). Đã chọn lọc, và email nhắc chỉ gửi một lần/hạn.
- Race: nhắc gửi xong nhưng người dùng vừa phản hồi, nên kiểm tra lại trạng thái trong transaction trước khi enqueue và trong dispatcher.
- Hạn thay đổi (gia hạn hold): phải đặt lại cờ nhắc theo hạn mới.
- Rò thông tin: giữ nguyên nguyên tắc payload tối giản; không đưa số điện thoại/CCCD, tên đối phương.
- Giới hạn Resend 2 req/s (`EMAIL_SEND_INTERVAL_MS=500`) làm chậm email nhắc 15 phút nếu tồn queue: ưu tiên job nhắc hoặc tăng tần suất tick (5s).
- Event cũ chưa có `deadlineAt`: template phải hiển thị được không có hạn.

## 5. Checklist theo thứ tự
1. Chốt path CTA người thuê/chủ nhà với web client; chốt ngưỡng nhắc (6h, 15 phút).
2. Core: thêm `deadlineAt` vào payload + test; chưa thêm event mới.
3. Notification: parse `deadlineAt`, `actionPath`, tổng quát hóa `EmailDeliveryService` + whitelist, giữ SYSTEM chạy như cũ (test hồi quy).
4. Template + test `rental-request`, `npm run mail:preview`.
5. Reset opt-in và bật UI Email cho RENTAL_REQUEST (mặc định TẮT).
6. Core: scheduler nhắc + migration cột `*_reminded_at` + event mới; notification: tiêu đề/whitelist cho event mới.
7. Thử trên staging: 1 người dùng bật Email, chạy luồng gửi, chấp nhận, hết hạn, nhắc; kiểm tra không trùng email và không có dữ liệu nhạy cảm.
8. Cập nhật `EMAIL_RESEND.md` (mục "Chưa làm").
