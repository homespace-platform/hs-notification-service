# Email cho module "Lịch hẹn xem nhà" (kế hoạch, chưa code)

Viết tắt: NS = hs-notification-service. LS = hs-core-api/hs-listing-service/src/main/java/com/hs/listing. VS = LS/service/ViewingAppointmentService.java. NE = NS/src/modules/notification-events/notification-event.ts.

## 1. Bảng sự kiện (10 eventType, category APPOINTMENT)

Mọi event do `AppointmentNotificationWriter.enqueue` ghi outbox (LS/notification/AppointmentNotificationWriter.java:40-64). Tiêu đề lấy từ NE:116-170.

| eventType | Nơi phát | Người nhận | Tiêu đề | Email? | Vì sao |
|---|---|---|---|---|---|
| BOOKING_REQUESTED | VS:254 | Chủ nhà | Yêu cầu đặt lịch mới | Có | Chủ nhà phải xử lý kịp, nếu không sẽ hết hạn (VS:642) |
| BOOKING_CONFIRMED | VS:281 | Người thuê | Lịch hẹn đã được xác nhận | Có (+.ics) | Lịch có hiệu lực, người thuê cần ghi nhớ |
| BOOKING_REJECTED | VS:303 | Người thuê | Yêu cầu đặt lịch bị từ chối | Không | Không cần hành động, xem trong app |
| BOOKING_RESCHEDULE_REQUESTED | VS:358 | Chủ nhà | Yêu cầu đổi lịch xem nhà | Có | Chủ nhà phải duyệt; giờ lấy từ proposed* (Writer:53-56) |
| BOOKING_RESCHEDULE_APPROVED | VS:395 | Người thuê | Yêu cầu đổi lịch được chấp nhận | Có (+.ics) | Giờ hẹn thay đổi |
| BOOKING_RESCHEDULE_REJECTED | VS:422 | Người thuê | Yêu cầu đổi lịch bị từ chối | Không | Giờ cũ giữ nguyên, app là đủ |
| BOOKING_CANCELLED | VS:449 (người thuê hủy, gửi chủ nhà); VS:471 (chủ nhà hủy, gửi người thuê); VS:524-525 (hệ thống hủy khi tin ngừng hiển thị, gửi bên không phải người thao tác) | Bên còn lại | Lịch hẹn đã bị hủy | Có | Tránh đi nhầm. Gửi cả hai hướng, kể cả hủy do hệ thống |
| BOOKING_COMPLETED | VS:492 (chủ nhà bấm); VS:658-659 (tự động, cả hai bên) | Người thuê / cả hai | Lịch xem nhà đã hoàn tất | Không | Không cần hành động, gửi tự động gây ồn |
| BOOKING_EXPIRED | VS:642-643 | Cả hai | Yêu cầu đặt lịch đã hết hạn | Có, chỉ người thuê | Người thuê cần biết để đặt lại; chủ nhà đã có email REQUESTED |
| BOOKING_REMINDER | LS/service/AppointmentReminderScheduler.java:37-38 | Cả hai (2 event) | Sắp đến lịch xem nhà | Có (+.ics) | Giảm vắng mặt, giá trị cao nhất |

## 2. Thiết kế từng email "Có"

Chung:
- Múi giờ: Asia/Ho_Chi_Minh. Payload chỉ có `appointmentDate` (YYYY-MM-DD) và `startTime` (HH:mm), đã là giờ VN (Writer:57-58; VS dùng VIETNAM_ZONE). Hiển thị "HH:mm, dd/MM/yyyy". Payload không có `endTime`.
- Mặc định: bật cho 5 nhóm giao dịch (xem rủi ro 1).
- Loại khỏi email: số điện thoại, email các bên, ghi chú (renterPhone, renterEmail, ownerNote, renterNote), lý do hủy/đổi. Hiện Kafka payload không mang chúng (whitelist 5 khóa ở NE:747) và phải giữ vậy.
- Địa chỉ: chỉ hiện cho bên đã xác nhận (CONFIRMED, RESCHEDULE_APPROVED, REMINDER). REQUESTED, RESCHEDULE_REQUESTED, CANCELLED, EXPIRED không có địa chỉ. Payload hiện chưa có địa chỉ, cần thêm (mục 4).
- Idempotency key: `appt:<eventId>:<recipientId>` (eventId là UUID mỗi lần enqueue, Writer:43). Chống trùng Kafka thêm bằng unique `(recipientId, sourceEventId)` như SYSTEM (docs/EMAIL_RESEND.md, Bước 1). Mẫu key hiện tại: email-delivery.service.ts:135.
- CTA: `MAIL_APP_BASE_URL` + actionPath có sẵn. Chủ nhà `/dashboard/viewing-schedules?appointmentId=<id>`, người thuê `/dashboard/viewing-schedules/my-bookings?appointmentId=<id>` (NE:933-936, 960-965).

| Email | Subject | Dòng chi tiết | Đính kèm | Key riêng |
|---|---|---|---|---|
| REQUESTED (chủ nhà) | Yêu cầu xem nhà mới: <tên tin> | Tin, ngày giờ yêu cầu. Không địa chỉ, không SĐT | Không | eventId |
| CONFIRMED (người thuê) | Lịch xem nhà đã được xác nhận: <tên tin> lúc HH:mm dd/MM | Tin, ngày giờ, địa chỉ | .ics | eventId |
| RESCHEDULE_REQUESTED (chủ nhà) | Khách đề nghị đổi lịch xem nhà | Tin, giờ đề xuất mới | Không | eventId |
| RESCHEDULE_APPROVED (người thuê) | Giờ xem nhà mới đã được chấp nhận | Tin, giờ mới, địa chỉ | .ics (cùng UID, SEQUENCE tăng) | eventId |
| CANCELLED (bên còn lại) | Lịch xem nhà đã bị hủy: <tên tin> | Tin, giờ đã hủy. Không ghi lý do chi tiết | Không (METHOD:CANCEL tùy chọn) | eventId |
| EXPIRED (người thuê) | Yêu cầu xem nhà đã hết hạn | Tin, giờ yêu cầu, nút "Đặt lại" | Không | eventId |
| REMINDER (cả hai) | Nhắc lịch xem nhà: <tên tin> lúc HH:mm | Tin, ngày giờ, địa chỉ | .ics | `appt-remind:<bookingId>:<date>T<time>:<recipientId>` |

## 3. Nhắc lịch và .ics

Job nhắc ĐÃ CÓ: `AppointmentReminderScheduler.remindUpcoming` chạy mỗi 60 giây (`fixedDelay=60000`, LS/service/AppointmentReminderScheduler.java:22), quét lịch CONFIRMED trong 24 giờ tới, gửi 1 lần cho mỗi cặp (ngày, giờ) nhờ cờ `reminderAppointmentDate/StartTime` (dòng 35-36, 39) và query `findReminderIds` (LS/repository/ViewingAppointmentRepository.java:19-23). Đổi lịch thì nhắc lại. Cron dọn dẹp riêng `listing.appointment-cleanup-cron=0 */15 * * * ?` (application.properties:236, dùng ở LS/service/ViewingAppointmentScheduler.java:20) lo expire/complete, không phải nhắc.

Lệch nhỏ với "nhắc trước một ngày": thực tế là cửa sổ 24 giờ, nên lịch xác nhận cách dưới 24 giờ sẽ nhắc gần như ngay sau email CONFIRMED (hai email sát nhau). Chấp nhận, hoặc bỏ email nhắc nếu CONFIRMED vừa gửi dưới 1 giờ trước. Không cần job mới. Thêm email chỉ là tiêu thụ event BOOKING_REMINDER đã có.

.ics: khả thi nhưng NS chưa hỗ trợ đính kèm. `SendEmailInput` chỉ có to/subject/html/text/idempotencyKey/tags (NS/src/modules/notification-delivery/email.provider.ts:8-15), body gửi Resend không có `attachments`. Resend nhận `attachments[{filename, content(base64), content_type}]`, nên thêm trường tùy chọn là đủ. Nội dung: `UID:<bookingId>@homespace`, `DTSTART;TZID=Asia/Ho_Chi_Minh`, SUMMARY, LOCATION, `SEQUENCE` tăng khi đổi lịch. Thiếu `endTime` nên cần thêm vào payload hoặc mặc định 1 giờ. Giá trị cao cho CONFIRMED, RESCHEDULE_APPROVED, REMINDER; thấp cho các mail khác. Đề xuất làm ở giai đoạn 2, sau khi email văn bản chạy ổn.

## 4. Thay đổi, rủi ro, checklist

Thay đổi:
- Core: thêm vào `data` `listingAddress` (rút gọn) và `endTime`, chỉ với CONFIRMED, RESCHEDULE_APPROVED, REMINDER (Writer:45-58). Không thêm SĐT/email.
- NS: mở whitelist khóa ở NE:747 cho 2 khóa mới (giới hạn độ dài, lọc ký tự như `listingTitle`).
- NS: tạo `templates/appointment/*.hbs` + `index.ts` (render, subject), xóa dòng liệt kê trong templates/appointment/README.md, thêm test ở email.spec.ts.
- NS: mở nhánh gọi email ở notification.service.ts:112-114 (hiện chỉ `SYSTEM` + `PLATFORM_ANNOUNCEMENT`) sang APPOINTMENT với đúng danh sách "Có"; sửa email-delivery.service.ts, email-outbox.ts để render theo eventType.
- NS giai đoạn 2: `attachments` ở email.provider.ts.

Rủi ro:
1. Cờ email mặc định: `email: item?.email ?? category !== 'SYSTEM'` (notification.service.ts:221) khiến APPOINTMENT đang là email=true theo mặc định cũ, test xác nhận (notification.service.spec.ts:455-478). Đó không phải sự đồng ý thật. Cần quyết định: bật mặc định (email giao dịch, đề xuất) hay opt-in như SYSTEM; nếu opt-in phải migrate APPOINTMENT.email về false.
2. Người nhận chưa có email trong Core: bỏ qua nhẹ nhàng, không throw.
3. Lộ địa chỉ cho lịch chưa xác nhận: chặn bằng whitelist theo eventType, không dựa vào "có dữ liệu thì hiện".
4. Hủy hàng loạt khi tin ngừng hiển thị (VS:524-525): dùng throttle có sẵn của dispatcher.
5. Tên tin là dữ liệu người dùng: bắt buộc escape Handlebars (Writer:49 chỉ lọc `<>`).
6. .ics: sai múi giờ nếu thiếu TZID; cần CRLF và gấp dòng 75 byte.

Checklist theo thứ tự:
1. Chốt mặc định (rủi ro 1) và danh sách "Có" với chủ dự án.
2. Core: thêm `listingAddress`, `endTime` có điều kiện theo eventType, kèm test (AppointmentNotificationWriterTest).
3. NS: nới whitelist NE:747 và cập nhật coverage-completion.spec.ts.
4. NS: template, render, test escape/subject/CTA cho 7 email.
5. NS: nối create -> EmailDeliveryService.enqueue theo eventType, key như mục 2.
6. Thử bằng `npm run mail:test`, `npm run mail:preview`.
7. Staging: kiểm tra không lộ SĐT, không lộ địa chỉ ở lịch PENDING.
8. Giai đoạn 2: attachments + .ics cho CONFIRMED, RESCHEDULE_APPROVED, REMINDER.
