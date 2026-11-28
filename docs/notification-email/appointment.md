# Email cho module "Lịch hẹn xem nhà" (kế hoạch, chưa code) - re-check 28/11

Viết tắt: NS = hs-notification-service. LS = hs-core-api/hs-listing-service/src/main/java/com/hs/listing. VS = LS/service/ViewingAppointmentService.java. NE = NS/src/modules/notification-events/notification-event.ts. W = LS/notification/AppointmentNotificationWriter.java.

Kết quả re-check: toàn bộ file:line của bản trước vẫn đúng với code hiện tại. Module Lịch hẹn không bị ảnh hưởng bởi thay đổi Membership. Không có event chết, không có event Core phát mà consumer không map. NS vẫn chưa gửi email cho APPOINTMENT.

## 1. Bảng đầy đủ (10 eventType, category APPOINTMENT, tab "Lịch hẹn")

Mọi event do `W.enqueue` ghi outbox (W:40-64); `data` chỉ có bookingId, recipientSide, listingTitle, appointmentDate, startTime (W:42-58). Consumer map ở NE:116-170, whitelist 5 khóa ở NE:753. Tiêu đề lấy từ NE.

| eventType | Phát ở | Người nhận | Tiêu đề | Email? | Lý do |
|---|---|---|---|---|---|
| BOOKING_REQUESTED | VS:254 (createAppointment) | Chủ nhà | Yêu cầu đặt lịch mới | Có | Chủ nhà phải xử lý, không thì hết hạn (VS:642) |
| BOOKING_CONFIRMED | VS:281 (approve) | Người thuê | Lịch hẹn đã được xác nhận | Có (+.ics) | Lịch có hiệu lực, cần ghi nhớ |
| BOOKING_REJECTED | VS:303 | Người thuê | Yêu cầu đặt lịch bị từ chối | Không | Không cần hành động, xem trong app |
| BOOKING_RESCHEDULE_REQUESTED | VS:358 | Chủ nhà | Yêu cầu đổi lịch xem nhà | Có | Chủ nhà phải duyệt; giờ lấy từ proposed* (W:53-56) |
| BOOKING_RESCHEDULE_APPROVED | VS:395 | Người thuê | Yêu cầu đổi lịch được chấp nhận | Có (+.ics) | Giờ hẹn đổi |
| BOOKING_RESCHEDULE_REJECTED | VS:422 | Người thuê | Yêu cầu đổi lịch bị từ chối | Không | Giờ cũ giữ nguyên |
| BOOKING_CANCELLED | VS:449 (người thuê hủy -> chủ nhà); VS:471 (chủ nhà hủy -> người thuê); VS:524-525 (hệ thống hủy khi tin ngừng hiển thị, gửi bên không phải người thao tác; gọi từ LS/service/ListingStatusService.java:379) | Bên còn lại | Lịch hẹn đã bị hủy | Có | Tránh đi nhầm; gửi cả hủy do hệ thống |
| BOOKING_COMPLETED | VS:492 (chủ nhà bấm, người thuê); VS:658-659 (tự động, cả hai) | Người thuê / cả hai | Lịch xem nhà đã hoàn tất | Không | Không cần hành động, tự động gây ồn |
| BOOKING_EXPIRED | VS:642-643 (autoExpire, cron 15 phút) | Cả hai | Yêu cầu đặt lịch đã hết hạn | Có, chỉ người thuê | Người thuê cần đặt lại; chủ nhà đã có email REQUESTED |
| BOOKING_REMINDER | LS/service/AppointmentReminderScheduler.java:37-38 | Cả hai (2 event, mỗi event 1 người nhận, NE:740) | Sắp đến lịch xem nhà | Có (không .ics, xem mục 3) | Giảm vắng mặt, giá trị cao nhất |

Ghi chú hành vi (đã đọc code): người thuê đặt lịch phải cách giờ hiện tại >= 1 giờ nếu là hôm nay (VS:219); đổi lịch cho phép cả khi lịch đang PENDING (VS:322-324), duyệt đổi lịch chuyển luôn thành CONFIRMED (VS:385) nên sau RESCHEDULE_APPROVED người thuê không nhận thêm BOOKING_CONFIRMED. PENDING hết hạn khi `endTime < now` (LS/repository/ViewingAppointmentRepository.java:73), nghĩa là chủ nhà có thể xác nhận đến hết khung giờ.

## 2. Email "Có" (7 email)

Chung:
- Múi giờ Asia/Ho_Chi_Minh; payload là giờ VN sẵn (W:57-58). Hiển thị "HH:mm, dd/MM/yyyy". Payload không có `endTime`, không có địa chỉ.
- Mặc định: BẬT cho 7 email giao dịch này (xem rủi ro 1). Không có email nào "luôn gửi" (không phải bảo mật). Người dùng tắt được theo category APPOINTMENT.
- Không đưa vào email: SĐT, email các bên, ghi chú, lý do hủy/từ chối (renterPhone, renterEmail, ownerNote, renterNote, cancelReason). Payload hiện không mang chúng, giữ nguyên.
- Địa chỉ: chỉ cho bên đã có lịch chắc chắn (CONFIRMED, RESCHEDULE_APPROVED, REMINDER). Chặn theo whitelist eventType, không theo "có dữ liệu thì hiện".
- Nút: `MAIL_APP_BASE_URL` + actionPath có sẵn: chủ nhà `/dashboard/viewing-schedules?appointmentId=<id>`, người thuê `/dashboard/viewing-schedules/my-bookings?appointmentId=<id>` (NE:938-965).
- Khoá chống trùng: `appt:<sourceEventId>:<recipientId>` (sourceEventId là UUID mỗi lần enqueue, W:43). Hiện Idempotency-Key là `sourceEventId:recipientId` (email-delivery.service.ts:135) và job unique theo notificationId; cần thêm unique `(recipientId, sourceEventId)` như kế hoạch SYSTEM.

| Email | Subject | Dòng thông tin | Nút | Đính kèm | Key |
|---|---|---|---|---|---|
| REQUESTED (chủ nhà) | Yêu cầu xem nhà mới: <tên tin> | Tin, ngày giờ yêu cầu | "Xem yêu cầu" | Không | eventId |
| CONFIRMED (người thuê) | Lịch xem nhà đã được xác nhận: <tên tin> lúc HH:mm dd/MM | Tin, ngày giờ, địa chỉ | "Xem lịch hẹn" | .ics (METHOD:REQUEST) | eventId |
| RESCHEDULE_REQUESTED (chủ nhà) | Khách đề nghị đổi lịch xem nhà | Tin, giờ đề xuất mới | "Duyệt đổi lịch" | Không | eventId |
| RESCHEDULE_APPROVED (người thuê) | Giờ xem nhà mới đã được chấp nhận | Tin, giờ mới, địa chỉ | "Xem lịch hẹn" | .ics cùng UID, SEQUENCE+1 | eventId |
| CANCELLED (bên còn lại) | Lịch xem nhà đã bị hủy: <tên tin> | Tin, giờ đã hủy (không lý do) | "Xem lịch" | .ics METHOD:CANCEL (tùy chọn, giai đoạn 2) | eventId |
| EXPIRED (người thuê) | Yêu cầu xem nhà đã hết hạn | Tin, giờ yêu cầu | "Đặt lại" | Không | eventId |
| REMINDER (cả hai) | Nhắc lịch xem nhà: <tên tin> lúc HH:mm | Tin, ngày giờ, địa chỉ | "Xem lịch hẹn" | Không | `appt-remind:<bookingId>:<date>T<time>:<recipientId>` |

Không có PDF nào cho module này; đính kèm duy nhất là .ics sinh tại NS (không cần S3, không cần Core).

## 3. Nhắc lịch, trùng CONFIRMED + REMINDER, và .ics

Job ĐÃ CÓ: `AppointmentReminderScheduler.remindUpcoming` mỗi 60 giây (`@Scheduled(fixedDelay=60000)`, LS/service/AppointmentReminderScheduler.java:22), quét lịch CONFIRMED active có giờ bắt đầu trong (now, now+24h], mỗi cặp (ngày, giờ) nhắc đúng 1 lần nhờ cờ `reminderAppointmentDate/StartTime` (dòng 35-36, 39-40; query `findReminderIds` ViewingAppointmentRepository.java:19-23). Đổi lịch thì nhắc lại. Cron expire/complete riêng 15 phút (application.properties:236, ViewingAppointmentScheduler.java:20), không phải nhắc. Không cần job mới; chỉ tiêu thụ BOOKING_REMINDER.

Vấn đề trùng: cửa sổ là 24 giờ nên mọi lịch được xác nhận (hoặc duyệt đổi lịch) khi còn dưới 24 giờ tới giờ hẹn sẽ nhận REMINDER trong vòng khoảng 1 phút sau CONFIRMED / RESCHEDULE_APPROVED; chủ nhà (vừa bấm duyệt) cũng nhận REMINDER ngay. Vì đặt lịch hôm nay chỉ cần cách >= 1 giờ (VS:219), trường hợp này rất phổ biến. In-app đã trùng sẵn, email sẽ trùng nữa.

Cách tránh (chọn A):
- A (đề xuất, chỉ NS, không đổi Core): khi tạo job email cho BOOKING_REMINDER, bỏ qua nếu cùng bookingId đã có event BOOKING_CONFIRMED hoặc BOOKING_RESCHEDULE_APPROVED với `occurredAt` trong 3 giờ gần nhất (đọc từ collection notification theo entityId = bookingId, giả định schema giữ bookingId; cần xác minh khi code). Áp cho cả hai bên: người thuê vừa nhận email xác nhận, chủ nhà vừa tự bấm duyệt. In-app REMINDER vẫn giữ.
- B (Core, nhỏ): ở `approveAppointment` (VS:279-281) và `approveReschedule` (VS:393-395), nếu giờ hẹn nằm trong 24 giờ tới thì đặt luôn `reminderAppointmentDate/StartTime` để scheduler không phát REMINDER. Cắt luôn cả in-app reminder, nên lịch sát giờ sẽ không có nhắc nào nữa (cần thêm nhắc 2 giờ nếu muốn, xem mục 4 thiếu #3).
- Không chọn: bỏ email REMINDER hoàn toàn, vì mất giá trị lớn nhất cho lịch xác nhận từ hơn 24 giờ trước.

.ics: KHẢ THI. `SendEmailInput` chỉ có to/subject/html/text/idempotencyKey/tags (NS/src/modules/notification-delivery/email.provider.ts:8-15) và body gửi Resend ở `JSON.stringify` (email.provider.ts:72) chưa có `attachments`; hiện không nơi nào trong NS/src dùng `attachments`. Resend nhận `attachments[{filename, content(base64), content_type}]`. Vì kế hoạch hợp đồng/thanh toán (contract.md, payment.md) cũng cần thêm `attachments?` vào `SendEmailInput`, chi phí thêm trường này dùng chung, .ics chỉ là thêm một hàm sinh chuỗi. Nội dung: `UID:<bookingId>@homespace`, `DTSTART;TZID=Asia/Ho_Chi_Minh`, `DTEND`, SUMMARY=tên tin, LOCATION=địa chỉ, `SEQUENCE` tăng khi đổi lịch (giả định: dùng số lần đổi lịch hoặc timestamp occurredAt làm SEQUENCE vì Core chưa lưu bộ đếm), CRLF, gấp dòng 75 byte, content_type `text/calendar; method=REQUEST`. Thiếu `endTime` trong payload: thêm vào payload hoặc mặc định 1 giờ. Chỉ đính cho CONFIRMED và RESCHEDULE_APPROVED (người thuê). REMINDER không đính .ics (lịch đã có từ email xác nhận; chủ nhà không có email xác nhận nhưng có sẵn lịch trong app). Làm ở giai đoạn 2 sau khi email văn bản chạy.

## 4. Thiếu thông báo (giờ không có event)

1. Yêu cầu đổi lịch bị bỏ quên: chủ nhà không phản hồi, giờ hẹn cũ trôi qua thì lịch tự COMPLETED hoặc EXPIRED và xóa yêu cầu (`clearReschedule`, VS:638, 656) mà không có event nào báo người thuê (và chủ nhà) rằng yêu cầu đổi lịch đã lỗi thời. Nên phát event mới (vd BOOKING_RESCHEDULE_EXPIRED, cần thêm vào NE và whitelist) hoặc dùng lại BOOKING_EXPIRED khi lịch đang có yêu cầu đổi.
2. Chủ nhà không có nhắc cho yêu cầu PENDING sắp hết hạn: chỉ có REQUESTED lúc đầu rồi EXPIRED khi đã muộn (VS:642). Nên có nhắc chủ nhà khoảng 2 giờ trước giờ hẹn nếu vẫn PENDING (bên Core, thêm vào AppointmentReminderScheduler với cờ riêng). Đây là thời hạn mà "bên chậm thua": chủ nhà không xác nhận thì yêu cầu tự hết hạn.
3. Chỉ có 1 nhắc 24 giờ; lịch sát giờ (xác nhận < 24 giờ) bị nhắc ngay khi xác nhận, nên không còn nhắc "sắp tới" khi gần giờ. Cân nhắc nhắc thứ hai khoảng 2 giờ trước (giả định: chỉ in-app + push, không email).
4. Hủy do hệ thống khi tin ngừng hiển thị (VS:524-525) không loại trừ bên thao tác nếu là admin/hệ thống (actorId khác cả hai bên): cả hai bên đều nhận, đúng ý. Không phải khoảng trống, ghi lại để tránh nhầm. Không có event "chủ nhà vắng mặt / khách vắng mặt"; không cần.

## 5. Rủi ro

1. Cờ email mặc định: `email: item?.email ?? category !== 'SYSTEM'` (NS/src/modules/notification/application/notification.service.ts:221) làm APPOINTMENT mặc định email=true; chỉ SYSTEM là opt-in (email-outbox.ts:173-177 `optedIn` cứng SYSTEM). Test khóa hành vi này (notification.service.spec.ts:455-478, notification.controller.spec.ts:368, in-memory-notification.repository.ts:135). Quyết định cần chốt: bật mặc định cho email giao dịch (đề xuất) và sửa `optedIn` theo category; phải đồng bộ với các module khác.
2. Gate gọi email hiện cứng `record.category === 'SYSTEM' && type === 'PLATFORM_ANNOUNCEMENT'` (notification.service.ts:112); `renderSystemBroadcastEmail` cứng ở email-delivery.service.ts. Cần allowlist eventType và registry render.
3. Người nhận chưa có email trong Core: bỏ qua nhẹ nhàng, không throw.
4. Tên tin là dữ liệu người dùng: W:49 chỉ lọc `<>` và ký tự điều khiển; bắt buộc escape Handlebars.
5. Hủy hàng loạt khi tin ngừng hiển thị: dùng throttle có sẵn của dispatcher.
6. .ics: sai múi giờ nếu thiếu TZID; lịch trùng nếu UID đổi giữa các lần gửi.

## 6. Việc cần làm (theo thứ tự)

Chốt với chủ dự án: mặc định email bật cho APPOINTMENT, danh sách 7 "Có", cách chống trùng REMINDER (A).

hs-core-api (LS):
1. Thêm vào `data` `listingAddress` (rút gọn) và `endTime`, chỉ với CONFIRMED, RESCHEDULE_APPROVED, REMINDER (W:45-58); test trong AppointmentNotificationWriterTest. Không thêm SĐT/email.
2. (Tùy chọn) khoảng trống #1 và #2: event mới hoặc tái dùng EXPIRED + nhắc chủ nhà PENDING; nếu chọn B ở mục 3 thì sửa VS:281 và VS:395.

hs-notification-service:
3. Nới whitelist khóa NE:753 cho `listingAddress`, `endTime` (giới hạn độ dài, lọc ký tự như `listingTitle`); cập nhật coverage-completion.spec.ts.
4. `templates/appointment/*.hbs` + `index.ts` (render + subject theo eventType) cho 7 email; test escape, subject, nút, không lộ địa chỉ ở PENDING trong email.spec.ts; xóa dòng liệt kê trong templates/appointment/README.md.
5. Nối tạo job email: allowlist eventType ở notification.service.ts:112, job lưu eventType, key `appt:...`, unique `(recipientId, sourceEventId)`, `optedIn` theo category, bỏ qua REMINDER theo quy tắc A.
6. Thử `npm run mail:test`, `npm run mail:preview`; staging kiểm tra không lộ SĐT, không lộ địa chỉ ở lịch PENDING.
7. Giai đoạn 2: `attachments?` ở email.provider.ts (dùng chung với hợp đồng/thanh toán) + hàm sinh .ics cho CONFIRMED, RESCHEDULE_APPROVED; METHOD:CANCEL cho CANCELLED.
