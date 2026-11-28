# Email cho module "Yêu cầu thuê" (RENTAL_REQUEST) - kiểm tra lại 28/11, chỉ kế hoạch

Viết tắt: `LS` = `hs-core-api/hs-listing-service/.../service/RentalRequestService.java`; `OB` = `hs-core-api/hs-contract-service/.../service/RentalOnboardingService.java`; `PR` = `.../PreTenancyResolutionService.java`; `W` = `.../listing/notification/RentalRequestNotificationWriter.java`; `CW` = `.../contract/notification/ComplaintNotificationWriter.java`; `NE` = `hs-notification-service/src/modules/notification-events/notification-event.ts`.
Kết quả đối chiếu code hiện tại: writer vẫn 26 event (`W:22-35`), khiếu nại 11 event (`CW:19-23`), mọi dòng trigger của bản cũ còn đúng. Không có event nào của 28/11 (membership) chạm module này. Sửa lỗi bản cũ: CTA người thuê KHÔNG phải `/dashboard/rental-requests/<id>` (web không có route này), xem mục 2.

## 1. Bảng đầy đủ (37 event Core đang phát; 0 chết, 0 chưa map)
Mọi event đều có mặt trong `NE` (rental `NE:30-55`, khiếu nại `NE:482-493`), nên không có event rơi DLT, không có event "chết". Người nhận: O = chủ nhà, R = người thuê. Hạn hiện tại: phản hồi 24h (`rental.response-hours`, `LS:262`), giữ chỗ 60 phút (`LS:325`), đổi ngày 24h, tháng đầu 24h, thông báo vi phạm >=24h (`application.properties:247-261`).

| eventType | Phát khi nào | Người nhận | Tiêu đề hiện tại (`NE`) | Email | Lý do |
|---|---|---|---|---|---|
| RENTAL_REQUEST_SUBMITTED | `LS:266` | O | Yêu cầu thuê đã được gửi | Có | Chủ nhà có 24h, quá hạn là hết hiệu lực |
| RENTAL_REQUEST_ACCEPTED | `LS:357` | R | ...đã được chấp nhận | Có | Giữ chỗ 60 phút, phải hành động ngay |
| RENTAL_REQUEST_REJECTED | `LS:402` | R | ...bị từ chối | Có | Kết quả quyết định |
| RENTAL_REQUEST_AUTO_REJECTED | `LS:359` | R | ...không được chọn | Không | Hệ quả người khác được chọn, in-app đủ |
| RENTAL_REQUEST_CANCELLED | `LS:440`, `OB:451`, `OB:514`, `PR:199` | bên còn lại | ...đã bị hủy | Có | Trạng thái cuối, bên kia cần biết |
| RENTAL_REQUEST_EXPIRED | `LS:592` (SYSTEM) | O+R | ...hết hạn phản hồi | Có | Hệ thống tự kết thúc do chậm phản hồi |
| RENTAL_HOLD_EXPIRED | `LS:626` (SYSTEM) | O+R | Thời gian giữ chỗ đã hết | Có | Mất giữ chỗ, phòng quay lại đăng |
| RENTAL_CANCELLATION_REQUESTED | `OB:479`, `PR:53` | bên kia | Có yêu cầu hủy thuê | Có | Cần phản hồi, hạn 48h |
| RENTAL_CANCELLATION_REFUND_PENDING | `OB:514`, `PR:164` | bên kia | Hủy thuê đang chờ hoàn tiền | Có | Liên quan tiền |
| RENTAL_CANCELLATION_REJECTED | `OB:513`, `PR:69` | bên đề nghị | ...bị từ chối | Gộp | Cùng template "kết quả hủy" |
| RENTAL_CANCELLATION_WITHDRAWN | `PR:68` | bên kia | ...đã được rút lại | Không | Phụ |
| RENTAL_CANCELLATION_DISPUTED | `PR:73` | bên kia | ...bị phản đối | Có | Chuyển sang tranh chấp |
| RENTAL_START_CHANGE_REQUESTED | `OB:349` | O | Có yêu cầu đổi ngày bắt đầu thuê | Có | Hạn 24h, ảnh hưởng hợp đồng |
| RENTAL_START_CHANGE_APPROVED / _REJECTED | `OB:393` | R | Đổi ngày ... được chấp nhận / bị từ chối | Có (1 template, 2 biến thể) | Kết quả quyết định |
| RENTAL_START_CHANGE_WITHDRAWN | `OB:401` | O | ...đã được rút lại | Không | Phụ |
| RENTAL_START_CHANGE_EXPIRED | `OB:206` (SYSTEM, trong `sync`) | O+R | ...đã hết hạn | Không | Tự phục hồi về ngày cũ, in-app đủ |
| RENTAL_SIGNING_WINDOW_REOPENED | `OB:527` | R | Thời gian ký hợp đồng được mở lại | Có | Có hạn mới |
| RENTAL_HOLD_EXTENDED | `OB:542` (O gia hạn); `OB:745` (SYSTEM, "hạn cuối thanh toán tháng đầu") | R; O+R | Thời gian giữ chỗ được gia hạn | Có | `OB:745` thực chất là CẢNH BÁO CUỐI, tiêu đề đang gây hiểu nhầm (xem mục 3) |
| RENTAL_DEFAULT_NOTICE_ISSUED | `OB:653` | bên kia (R) | Có thông báo về yêu cầu thuê (HIGH, `NE:23`) | Có | Vi phạm hạn, mất cọc nếu không xử lý |
| RENTAL_DEFAULT_DISPUTED | `OB:661` | O | ...bị phản đối | Có | Pháp lý/tiền cọc |
| RENTAL_REQUEST_CANCELLED_BY_SYSTEM | `OB:696` (O chốt vi phạm), `OB:759` (SYSTEM, quá hạn tháng đầu) | R; O+R | ...bị hủy bởi hệ thống | Có | Kết quả cuối, mất giữ chỗ/cọc |
| RENTAL_RESUME_REQUESTED | `PR:94` | bên kia | Có yêu cầu tiếp tục thuê | Có | Cần phản hồi |
| RENTAL_RESUMED | `PR:103` | bên kia | ...đã được tiếp tục | Gộp | Cùng template "kết quả tiếp tục" |
| RENTAL_RESUME_REJECTED | `PR:109` | bên đề nghị | ...bị từ chối | Gộp | như trên |
| RENTAL_RESUME_WITHDRAWN | `PR:109` | bên kia | ...đã được rút lại | Không | Phụ |
| COMPLAINT_OPENED | `CW:46-47` (`ComplaintCaseService:155`) | bên kia (PARTY); admin (ADMIN) nếu đã ESCALATED | Có hồ sơ khiếu nại mới | Có (chỉ PARTY) | Bị khiếu nại phải biết, có hạn 48h (`application.properties:268`) |
| COMPLAINT_INFO_REQUESTED | `CW:63` | bên bị yêu cầu | Cần bổ sung thông tin khiếu nại | Có | Có hạn, chậm là thua |
| COMPLAINT_DECIDED | `CW:65` | cả hai | HomeSpace đã kết luận lần đầu | Có | Kết luận, còn quyền phản hồi |
| COMPLAINT_FINAL_DECISION | `CW:65,70` (`FINALIZED` do SYSTEM, `ComplaintCaseService:277`) | cả hai | ...kết luận lần cuối | Có | Kết luận cuối, có thể tự chốt do hết hạn |
| COMPLAINT_ESCALATED | `CW:53` | bên kia + admin | Khiếu nại đã chuyển HomeSpace | Có (chỉ PARTY) | Đổi người xử lý, tranh chấp leo thang |
| COMPLAINT_CLOSED / _REOPENED | `CW:66,68` | bên kia | Hồ sơ đã đóng / được mở lại | Gộp | 1 template "cập nhật trạng thái hồ sơ" |
| COMPLAINT_COMMENTED | `CW:50-51` | bên kia/cả hai/admin | Có trao đổi trong hồ sơ | Không | Rất nhiều, dễ spam, in-app đủ |
| COMPLAINT_ASSIGNED | `CW:55-57` | cả hai + admin cũ | HomeSpace đã tiếp nhận khiếu nại | Không | Thông tin phụ |
| COMPLAINT_WITHDRAWN | `CW:67` | bên kia | Hồ sơ khiếu nại đã được rút | Không | Phụ |
| COMPLAINT_SOURCE_UPDATED | `CW:69` | bên kia + admin | Hồ sơ khiếu nại có cập nhật | Không | Phụ |

Đếm: rental 26 = 18 Có + 3 Gộp + 5 Không; khiếu nại 11 = 5 Có + 2 Gộp + 4 Không. Tổng email-yes (kể cả gộp) = 28 event, ra khoảng 12 template (xem mục 2). Admin (audience `ADMIN`) KHÔNG nhận email: việc nội bộ, link ở admin portal (`NE:809` -> `/operations/complaints?caseId=`, route `hs-admin-portal/src/router/index.tsx:124`), khác domain `MAIL_APP_BASE_URL` của web.

## 2. Chi tiết email "Có" (và "Gộp")
Nền tảng hiện tại (đã đối chiếu): email chỉ chạy cho `SYSTEM`+`PLATFORM_ANNOUNCEMENT` (`notification.service.ts:112-114`); `EmailDeliveryService.enqueue` chỉ kiểm tra opt-in (`email-delivery.service.ts:58-62`); `process` cứng `renderSystemBroadcastEmail` (`:128`), idempotency `<broadcastId>:<userId>` (`:135`); `EmailProvider` chưa có attachments; thư mục mẫu `email/templates/rental-request/` chỉ có README (đường dẫn thật là `src/modules/notification-delivery/email/templates/`, bản cũ ghi thiếu `email/`). Email người nhận lấy qua `user-email.directory.ts`, không đưa vào Kafka.

Quy ước chung: subject `[HomeSpace] <tiêu đề>` (+ `[Quan trọng]` cho nhóm hạn/tiền/pháp lý); hàng thông tin: Tin đăng (`listingTitle`, đã làm sạch `W:63-68`), Mã yêu cầu (8 ký tự đầu), vai trò của bạn, hạn (nếu có). KHÔNG đưa: số điện thoại, CCCD, tên đối phương, lý do hủy/từ chối/khiếu nại, số tiền, STK (chỉ "xem trong ứng dụng"). Không đính kèm PDF (module này không có PDF; hợp đồng/biên nhận thuộc module khác, nếu cần chỉ nhắc "xem trong ứng dụng"). Mặc định: theo cờ `email` của mục RENTAL_REQUEST, mặc định TẮT (opt-in), cờ theo category chứ không theo từng event (`notification.model.ts:71`); thông báo khiếu nại/vi phạm có hạn pháp lý: đề xuất (giả định, owner chốt) nhóm `[Quan trọng]` vẫn theo cờ nhưng hiển thị cảnh báo trong UI Cài đặt khi tắt. Khoá chống trùng: `rental:<eventId>:<recipientId>` (eventId UUID `W:56`, `CW:write`), vì mỗi người nhận có 1 eventId riêng nên phát lại Kafka không gửi lại.

Nút (CTA), `MAIL_APP_BASE_URL` + path, lấy từ code hiện tại (`NE:938-956`, `NE:805-811`) và xác nhận route tồn tại trong `hs-web-app`:
- O (chủ nhà): `/dashboard/rental-requests?requestId=<requestId>` (`app/dashboard/rental-requests/page.tsx`, mode RECEIVED).
- R (người thuê): `/dashboard/rental-requests/my-requests?requestId=<requestId>` (`.../my-requests/page.tsx`, mode SENT). Cả hai trang dùng `RentalRequestsManagement` + `useRentalRequestDeepLink` (mở chi tiết theo `?requestId`, chưa đăng nhập thì đưa qua login; `RentalRequestsManagement.tsx:63-70`).
- Khiếu nại PARTY: `/dashboard/complaints?requestId=<rentalRequestId>&complaintId=<caseId>` (`app/dashboard/complaints/page.tsx:11` đọc đúng 2 tham số).
- Lưu ý: `actionPath` trong `NE` là đường dẫn tương đối của web, KHÔNG dùng cho audience ADMIN.

| Template | Gồm event | Subject | Hàng thêm | Hạn cần có trong payload |
|---|---|---|---|---|
| rental-new-request | SUBMITTED | Có yêu cầu thuê mới, phản hồi trong 24 giờ | Hạn phản hồi (`respondBy`) | respondBy |
| rental-accepted | ACCEPTED | Chủ nhà đã chấp nhận, giữ chỗ tới <giờ> | Hạn giữ chỗ (`holdExpiresAt`), bước tiếp theo | holdExpiresAt |
| rental-final-state | REJECTED, CANCELLED, EXPIRED, HOLD_EXPIRED, CANCELLED_BY_SYSTEM | theo tiêu đề `NE` | Kết quả cuối, phòng đã được thả | không |
| rental-action-needed | CANCELLATION_REQUESTED, REFUND_PENDING, DISPUTED, RESUME_REQUESTED, START_CHANGE_REQUESTED | tiêu đề + "cần phản hồi" | Hạn phản hồi 24h/48h | deadlineAt |
| rental-deadline-important | SIGNING_WINDOW_REOPENED, HOLD_EXTENDED, DEFAULT_NOTICE_ISSUED, DEFAULT_DISPUTED | `[Quan trọng]` + tiêu đề | Hạn mới/hạn cuối, "hợp đồng chưa được ký", hậu quả nếu quá hạn | deadlineAt |
| rental-decision-result | START_CHANGE_APPROVED/REJECTED, CANCELLATION_REJECTED, RESUMED, RESUME_REJECTED | theo kết quả | Kết quả | không |
| complaint-opened/info | COMPLAINT_OPENED, INFO_REQUESTED, ESCALATED | tiêu đề `NE:482-493` | Hạn trả lời (`homespace.complaint.response-hours=48`) | deadlineAt (chỉ INFO_REQUESTED/OPENED) |
| complaint-decision | DECIDED, FINAL_DECISION, CLOSED, REOPENED | tiêu đề `NE` | Kết luận ở trong hồ sơ, không chép nội dung | không |

## 3. Thiếu thông báo
1. Không có nhắc "sắp hết hạn" cho yêu cầu thuê (grep: chỉ có `AppointmentReminderScheduler`, `AgreementSigningReminderScheduler:55` cho ký hợp đồng, `PaymentDueReminderScheduler:26` nhắc 24h cho INITIAL/RESERVATION_DEPOSIT qua `PAYMENT_DUE_SOON`). Cần thêm (a) chủ nhà: PENDING còn <=6h tới `respondBy`; (b) người thuê: ACCEPTED còn <=15 phút tới `holdExpiresAt`; (c) bên nhận yêu cầu hủy/đổi ngày/tiếp tục còn <=6h; (d) bên bị yêu cầu bổ sung khiếu nại còn <=12h. Hạn thanh toán tháng đầu đã được `PAYMENT_DUE_SOON` phủ (module PAYMENT, tránh email trùng).
2. Hạn ký thỏa thuận đặt cọc `rental.deposit-signing-hours=48` (`DepositAgreementService.java:47`): không thấy nhắc hạn (giả định, grep chưa thấy scheduler), cần thêm hoặc mở rộng `AgreementSigningReminderScheduler`.
3. Payload không mang hạn (`W:19-20`, validator `NE:760` chỉ cho `requestId,recipientSide,listingTitle`; khiếu nại `NE:639` cố định `audience,caseId,rentalRequestId`): email không nêu được giờ hạn.
4. `RENTAL_HOLD_EXTENDED` dùng cho hai việc khác nhau (chủ nhà gia hạn `OB:542` và hệ thống cảnh báo cuối hạn trả tháng đầu `OB:745`), người nhận sẽ thấy "được gia hạn" thay vì "cảnh báo cuối" -> cần event riêng (vd `RENTAL_FIRST_RENT_FINAL_WARNING`).
5. Chủ nhà không có thông báo khi người thuê thanh toán tháng đầu/ký cọc ở nhóm này (nằm module PAYMENT/hợp đồng, cần đối chiếu để không sót).
6. Khi `RENTAL_REQUEST_EXPIRED`/`HOLD_EXPIRED` thả phòng, không có thông báo cho người đã bị `AUTO_REJECTED` rằng phòng mở lại (không bắt buộc, giả định bỏ).

## 4. Việc cần làm
hs-core-api:
1. Thêm `deadlineAt` (ISO instant) vào `data` của `W` cho event có hạn (SUBMITTED, ACCEPTED, REQUESTED/DISPUTED/RESUME_REQUESTED, SIGNING_WINDOW_REOPENED, HOLD_EXTENDED, DEFAULT_NOTICE) và vào `CW.write` cho OPENED/INFO_REQUESTED; sửa javadoc `W:17-18` và test `RentalRequestNotificationWriterTest`, `RentalWorkflowPostgresTest`, `ComplaintCasePostgresTest`.
2. Tách event cảnh báo cuối `OB:745` khỏi `RENTAL_HOLD_EXTENDED` (event mới, không đổi enum cũ để outbox đang chờ còn đọc được).
3. Scheduler nhắc 4 loại ở mục 3.1 theo mẫu `AppointmentReminderScheduler` (khóa dòng, cột `*_reminded_at` + migration, đặt lại cờ khi hạn đổi, kiểm tra lại trạng thái trước khi enqueue); thêm nhắc hạn ký cọc nếu mục 3.2 đúng.
hs-notification-service:
4. `NE`: cho phép `deadlineAt` tùy chọn ở `NE:639`/`NE:760`; thêm title/body/priority cho event mới; đảm bảo `actionPath` đủ cho event rental khiếu nại (đã có).
5. Tổng quát hóa `EmailDeliveryService`: bỏ điều kiện `SYSTEM` (`notification.service.ts:112`), whitelist eventType "Có/Gộp", chọn template theo eventType (`email-delivery.service.ts:128`), idempotency key mục 2, chỉ gửi cho audience PARTY.
6. Template `email/templates/rental-request/*.hbs` + `index.ts` (xóa README) + test cạnh `email.spec.ts` (escape, subject, link đúng route, thiếu `deadlineAt`, ADMIN không gửi).
7. Mở rộng `emailOptInReset` (`mongo-notification-preference.repository.ts:27-41`) cho RENTAL_REQUEST (mặc định TẮT) và bật tùy chọn "Email" của mục này trong UI Cài đặt.
hs-web-app: không cần route mới (đã có `?requestId=`, `?complaintId=`), chỉ cần đảm bảo trang cài đặt hiển thị tùy chọn Email cho mục "Yêu cầu thuê".
Rủi ro: spam (1 yêu cầu có thể sinh nhiều email, đã lọc), race giữa nhắc và phản hồi, hạn thay đổi sau gia hạn, rò thông tin (giữ payload tối giản), giới hạn Resend 2 req/s làm chậm nhắc 15 phút (ưu tiên job nhắc).
