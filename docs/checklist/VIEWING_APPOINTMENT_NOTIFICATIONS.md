# Checklist tích hợp thông báo — đặt lịch xem phòng

Cập nhật: 13/11/2026. Trạng thái: **đã triển khai Core → Kafka → notification và frontend; kết quả kiểm chứng ghi ở mục 9**.

Tài liệu này được cập nhật theo tiến độ thực tế. `[x]` là việc đã kiểm tra/làm xong trong phạm vi ghi rõ; `[ ]` chưa làm. Không coi việc đọc test là đã chạy test.

## 1. Phạm vi và kết quả review

- [x] Kiểm tra folder `docs/checklist`: ban đầu chưa có file.
- [x] Agent backend rà controller, service, repository/entity, scheduler, caller đổi trạng thái tin đăng và test đặt lịch trong `hs-core-api`.
- [x] Agent frontend rà nút Đặt lịch xem, modal đặt/đổi/hủy, hai dashboard, deep-link và popup trong `hs-web-app`.
- [x] Agent notification rà envelope Kafka, validation, template, persistence/dedup, socket và push trong `hs-notification-service`.
- [x] Đối chiếu kết quả giữa ba phía và lập bảng người nhận/đường dẫn bên dưới.
- [x] Sửa lỗi nghiệp vụ và bổ sung backend producer qua transactional outbox.
- [x] Mở rộng contract/template notification và deep-link frontend.
- [ ] Chạy kiểm thử tích hợp hai tài khoản thật và push khi đóng tab.

Lịch sử: đợt review đầu chỉ thêm tài liệu. Đợt triển khai tiếp theo sửa `hs-core-api`, `hs-notification-service`, `hs-web-app` và cấu hình topic trong `hs-infra`. Thay đổi bỏ observer title từ lượt xử lý lag trước được giữ lại.

## 2. Luồng hiện có và nguyên tắc tích hợp

Khách B thao tác → Core kiểm tra quyền và trạng thái → ghi nghiệp vụ → phát event bền vững → Kafka → notification service lưu thông báo cho A → socket popup/badge và push theo thiết lập → A bấm mở đúng lịch.

- Backend quyết định người nhận từ `ownerId`/`renterId`; dùng identity Keycloak `sub` đang được lưu làm user ID. Không nhận danh sách người nhận tùy ý từ frontend.
- Người thao tác vẫn nhận toast thành công/lỗi hiện có; thông báo nghiệp vụ gửi cho bên đối diện. Không gửi thêm popup cho chính actor.
- Event chỉ đại diện cho thay đổi đã commit thành công. Validation fail, quyền sai, rollback hoặc thao tác không đổi trạng thái không phát thông báo thành công.
- Notification là lịch sử; trạng thái và quyền hiện tại của lịch phải đọc lại từ Core khi mở chi tiết.
- Truyền tối thiểu ID và loại thay đổi. Không đưa điện thoại/email/lý do riêng tư vào socket/push chỉ để hiển thị popup.

## 3. Ma trận sự kiện đề xuất

`OWNER`/`RENTER` dưới đây là phía tham gia lịch, không phải role quản trị trong Keycloak. Các tên event trong bảng đã được triển khai. Số dòng là vị trí ở snapshot review trước sửa.

| Thao tác đã có | Điểm backend (`ViewingAppointmentService.java`) | Người nhận | Event đề xuất | Mở khi bấm |
|---|---|---|---|---|
| Khách gửi đặt lịch | `createAppointment:181` | Chủ nhà | `BOOKING_REQUESTED` (đã có template) | Owner detail |
| Chủ nhà chấp nhận | `approveAppointment:257` | Khách | `BOOKING_CONFIRMED` (đã có) | Renter detail |
| Chủ nhà từ chối | `rejectAppointment:283` | Khách | `BOOKING_REJECTED` | Renter detail |
| Khách yêu cầu đổi giờ | `requestReschedule:302` | Chủ nhà | `BOOKING_RESCHEDULE_REQUESTED` | Owner detail |
| Chủ nhà duyệt đổi giờ | `approveReschedule:357` | Khách | `BOOKING_RESCHEDULE_APPROVED` | Renter detail |
| Chủ nhà từ chối đổi giờ | `rejectReschedule:393` | Khách | `BOOKING_RESCHEDULE_REJECTED` | Renter detail |
| Khách hủy | `cancelByRenter:418` | Chủ nhà | `BOOKING_CANCELLED` (đã có) | Owner detail |
| Chủ nhà hủy | `cancelByOwner:443` | Khách | `BOOKING_CANCELLED` | Renter detail |
| Chủ nhà đánh dấu hoàn tất | `completeAppointment:463` | Khách | `BOOKING_COMPLETED` | Renter detail |
| Tin đăng không còn khả dụng, hệ thống hủy lịch tương lai | `cancelActiveAppointmentsForListing:482` | Khách; chủ nhà nếu thay đổi do admin/system, cần giữ actor/source | `BOOKING_CANCELLED` | Theo phía nhận |
| PENDING quá hạn, scheduler | `autoExpirePendingAppointments:600` | Hai bên | `BOOKING_EXPIRED` | Theo phía nhận |
| CONFIRMED quá giờ, scheduler hoàn tất | `autoCompleteConfirmedAppointments:612` | Hai bên | `BOOKING_COMPLETED` | Theo phía nhận |

Đợt này bao phủ cả thao tác trực tiếp, auto-cancel và scheduler. Mọi event dùng delivery chuẩn: lưu feed, socket và push theo thiết lập người dùng, kể cả scheduler. Chưa thêm nhánh delivery riêng cho scheduler hoặc nhắc hẹn trước giờ.

Không có auto-reject các lịch khác cùng khung giờ khi duyệt một lịch. Test `testApprove_doesNotRejectOtherPendings` xác nhận hành vi này có chủ ý; không phát event từ chối cho các lịch đó.

## 4. Phát hiện tại thời điểm review và checklist khắc phục

### P1 — Duyệt đổi lịch có thể phục hồi lịch đã kết thúc

`approveReschedule` chỉ kiểm tra `rescheduleRequested`, rồi đặt status thành `CONFIRMED`. Các nhánh cancel/expire/complete không xóa flag yêu cầu đổi lịch. Vì vậy lịch đã `CANCELLED`/`EXPIRED`/`COMPLETED` vẫn có thể được duyệt đổi lịch nếu flag còn bật. `rejectReschedule` cũng chưa kiểm tra trạng thái còn active.

- [x] Chặn approve/reject reschedule trên trạng thái kết thúc và dọn đề xuất đổi giờ khi lịch kết thúc; cập nhật quy tắc action trong luồng AI để giữ parity.
- [x] Regression test guard trạng thái kết thúc và dọn proposal; nhánh bị từ chối không phát event xác nhận.

### P1 — Chưa có cơ chế phát event nghiệp vụ bền vững

Core chưa có notification producer/outbox. Các mutation là `@Transactional`; gửi Kafka trước commit có thể tạo thông báo cho thay đổi bị rollback. Chỉ dùng listener sau commit vẫn có khoảng mất event khi process chết hoặc broker lỗi.

- [x] Ghi outbox cùng transaction với thay đổi lịch; publisher retry bằng event ID/payload không đổi, chỉ đánh dấu đã gửi sau broker acknowledgement.
- [x] Dùng Spring Kafka, không tạo topic trong service; topic thuộc `hs-infra`.
- [x] Kiểm tra claim nhiều worker bằng PostgreSQL thật và retry cùng payload. Consumer đã kiểm chứng dedup qua Kafka/Mongo thật; chưa kill process tại đúng thời điểm sau ack/trước DB commit.
- [x] Auto-cancel không còn nuốt lỗi persistence/outbox. Publisher Kafka chạy riêng sau commit, không gửi đồng bộ trong mutation listing.

### P1 — Thao tác đồng thời có thể tạo trạng thái/thông báo trái nhau

`ViewingAppointment` chưa có `@Version`; đường read-modify-save chưa khóa record. Hai thao tác approve/cancel hoặc scheduler có thể cùng đọc trạng thái cũ rồi ghi đè nhau. Đây là rủi ro thấy từ source, chưa tái hiện bằng test.

- [x] Khóa pessimistic record lịch khi mutation và query scheduler/auto-cancel; khóa listing khi tạo lịch.
- [x] Test PostgreSQL: approve phải chờ cancel đang giữ khóa, sau đó bị từ chối; không có event confirmed giả.

### P2 — Click thông báo chưa mở đúng lịch trong mọi trường hợp

Route thật đã có:

- Chủ nhà: `/dashboard/viewing-schedules?appointmentId=<uuid>`.
- Khách: `/dashboard/viewing-schedules/my-bookings?appointmentId=<uuid>`.
- `status` là hint tùy chọn; không dùng status cũ trong notification làm nguồn trạng thái hiện tại.
- Event gọi ID là `bookingId`, query frontend gọi `appointmentId`; cần mapping rõ ràng.
- Dashboard đã suy ra landlord/tenant từ hai URL qua `lib/dashboard-role.ts`; tái sử dụng.

`components/appointment/useAppointmentDeepLink.ts` đang dùng cờ `handled` boolean và effect theo `authenticated`; đổi query trên cùng page không mở lịch tiếp theo. Hook tìm ID bằng cách quét tối đa 20 trang × 6 status, có thể tới 120 GET và vẫn bỏ sót lịch cũ.

- [x] Thêm `GET /appointments/{id}` có kiểm tra chỉ owner/renter được xem; frontend gọi qua `/api/v1/appointments/{id}`.
- [x] Deep-link theo dõi query, hỗ trợ lịch thứ hai trên cùng route; dùng detail API thay quét danh sách. Đóng modal xóa appointmentId/status nhưng giữ query khác để bấm lại cùng lịch vẫn mở được.
- [x] Hiển thị lỗi không tồn tại/không có quyền; xóa lựa chọn cũ trước khi tải ID mới và bỏ kết quả request đã hết hiệu lực.

### P2 — Popup và dữ liệu trang lịch chưa nối với nhau

`components/notification/NotificationTransport.tsx` không giữ `actionPath` trong kiểu popup và link đang hardcode `/notifications`. Dropdown và trang notification đã dùng `getSafeActionPath`.

- [x] Popup dùng action path đã kiểm tra; fallback `/notifications` khi thiếu hoặc không hợp lệ.
- [x] Hai dashboard subscribe `appointment-changed` để refresh list/count/detail. Socket mới lọc category APPOINTMENT; focus/reconnect/push generic dùng recovery chung vì không có category trong push.
- [x] Cập nhật snapshot sau thao tác local, refresh detail sau remote change; đóng detail nếu không thể xác minh lại quyền/dữ liệu.
- [x] Coalesce 250 ms và gộp refresh đang chạy; cleanup subscription/timer; key page theo userId để reset state khi đổi tài khoản.
- [x] Giữ cơ chế title không dùng observer toàn `<head>` đã sửa ở lượt trước.

### P2 — Contract hiện chưa phân biệt phía nhận

`src/modules/notification-events/notification-event.ts` chỉ có `BOOKING_REQUESTED`, `BOOKING_CONFIRMED`, `BOOKING_CANCELLED`, category `APPOINTMENT`, data chính xác `{ bookingId }`; thêm field hiện sẽ bị đưa vào DLT. `renderNotification` luôn sinh `/notifications`.

- [x] Đủ 9 loại event trong ma trận và template tiếng Việt tương ứng.
- [x] Booking data có `recipientSide: OWNER | RENTER` được kiểm tra enum; render URL từ route cố định, không nhận URL tùy ý từ producer.
- [x] Giữ tương thích event cũ chỉ có `bookingId`: fallback về `/notifications`.
- [x] Khi hệ thống gửi cả hai phía, tạo envelope riêng cho từng phía; auto-cancel loại actor khỏi người nhận.
- [x] Test payload realtime giữ actionPath/metadata và replay không phát notification:new trùng.

## 5. Các invariant của contract đang có

- Envelope v1 chỉ gồm `eventId`, `eventType`, `version`, `occurredAt`, `recipients`, `data`; field lạ bị từ chối.
- `occurredAt` phải UTC với đúng ba chữ số millisecond: `2026-11-13T01:00:00.000Z`. Java `Instant.toString()` có thể thiếu `.000` hoặc nhiều hơn ba số; producer cần formatter đúng schema.
- Mỗi chuyển trạng thái có event ID mới; retry cùng event giữ ID và payload. Không dùng duy nhất booking ID làm event ID cho cả vòng đời vì dedup sẽ nuốt các thay đổi sau.
- Kafka key theo booking ID để giữ thứ tự trong partition. Cần kiểm tra outbox publisher không đảo thứ tự các event cùng lịch.
- Consumer dedup theo `(recipientId, sourceEventId)`, emit `notification:new` khi insert mới và enqueue push có cơ chế phục hồi; tái sử dụng phần này.
- Push hiện là tín hiệu chung `Bạn có thông báo mới.`, service worker mở `/notifications` để bảo vệ thông tin khi dùng chung trình duyệt. Click từ trung tâm thông báo mới đi tới lịch sau xác thực. Chưa mở rộng push để mang thông tin lịch/đường dẫn riêng tư.
- REST read/read-all/delete đã đồng bộ notification state; không tự đánh dấu đã đọc chỉ vì popup xuất hiện.

## 6. Checklist triển khai và kiểm chứng theo thứ tự

1. [x] Core: sửa reschedule guard, kiểm chứng mutation cạnh tranh; giữ validation/ownership hiện có.
2. [x] Core: thêm detail API có ownership, outbox + publisher và cấu hình topic/broker theo convention hiện có.
3. [x] Notification: mở rộng schema/template/route; test event cũ, field sai, side sai, template và dedup.
4. [x] Core: gắn event vào mọi mutation trong ma trận, kể cả auto-cancel và scheduler; kiểm tra recipient, rollback và retry.
5. [x] Web: detail deep-link, query thay đổi cùng route, popup actionPath, refresh list/modal đúng loại sự kiện.
6. [x] Focused tests từng repo, typecheck/build cần thiết; kết quả chi tiết ở mục 9.
7. [ ] Kiểm thử hai tài khoản trên Chrome theo bảng dưới. Đã có kiểm thử backend/database thật, chưa thay thế browser E2E.

| Tình huống cần thử | Kết quả mong đợi | Kết quả thực tế |
|---|---|---|
| B đặt lịch, A đang mở web | A có một notification + popup góc trái + badge/title; B chỉ toast thao tác | Chưa chạy |
| A duyệt/từ chối/hủy, B online | B nhận đúng loại, bấm mở lịch phía khách với trạng thái hiện tại | Chưa chạy |
| Đổi lịch: gửi/duyệt/từ chối | Đúng người nhận, không báo xác nhận nhầm thành yêu cầu mới | Chưa chạy |
| B hủy, A online | A mở đúng lịch phía chủ nhà | Chưa chạy |
| Click hai thông báo khác nhau trên cùng page | Modal chuyển đúng ID lần thứ hai | Chưa chạy |
| Lịch cũ ngoài các trang đầu, bị đổi status | Detail vẫn tải được bằng ID, không quét hàng chục trang | Chưa chạy |
| User C thay ID trong URL/API | Không đọc được lịch A/B | Chưa chạy |
| List/modal đang mở khi bên kia thao tác | Trạng thái/nút/count tự cập nhật, không request storm | Chưa chạy |
| Broker tắt rồi phục hồi/process restart | Booking đã lưu, event được gửi lại; không mất hoặc tạo notification trùng | Chưa chạy |
| Rollback/permission fail/duplicate retry | Không có notification giả; một transition hợp lệ chỉ một notification mỗi người | Chưa chạy |
| Owner approve đồng thời renter cancel/scheduler | Trạng thái cuối và event nhất quán; không resurrect lịch | Chưa chạy |
| Auto-cancel do listing unavailable | Khách được báo, click mở lịch đã hủy; đúng actor/source nếu báo cả chủ nhà | Chưa chạy |
| B đóng tab, Chrome thường còn chạy, đã đăng ký push | Chrome hiển thị generic push; mở feed rồi vào đúng lịch | Chưa chạy |
| Logout/đổi tài khoản, nhiều tab | Không lộ dữ liệu tài khoản cũ, không nhân đôi popup cùng event | Chưa chạy |

## 7. Source tham chiếu

- Core: `hs-api-service/.../controller/listing/ViewingAppointmentController.java`; `hs-listing-service/.../service/ViewingAppointmentService.java`, `ViewingAppointmentScheduler.java`, `ListingStatusService.java`; entity/repository và `ViewingAppointmentServiceTest.java`.
- Web: `components/rent/RentDetailView.tsx`, `components/appointment/BookingAppointmentModal.tsx`, `AppointmentDetailModal.tsx`, `useAppointmentDeepLink.ts`; `app/dashboard/viewing-schedules/page.tsx`, `my-bookings/page.tsx`; `services/appointment.service.ts`.
- Web thông báo: `NotificationTransport.tsx`, `NotificationDropdown.tsx`, `app/notifications/page.tsx`, `services/notification.service.ts`, `public/firebase-messaging-sw.js`; route builder `lib/ai-appointment-cards.ts` và test tương ứng.
- Notification: `src/modules/notification-events/notification-event.ts`, consumer/spec; notification application/persistence/realtime/delivery modules; `docs/KAFKA_TESTING.md`, `docs/REALTIME_TESTING.md`, `docs/PUSH_SETUP.md`.

## 8. Nhật ký

| Ngày | Công việc hoàn tất | Verification và giới hạn |
|---|---|---|
| 13/11/2026 | Ba agent rà backend/frontend/notification; tổng hợp ma trận và các gap; tạo checklist này | Review source và test hiện có, đối chiếu trực tiếp reschedule guard; chưa chạy test/build/browser vì chưa thay runtime code. Rủi ro concurrency chưa được tái hiện. |
| 13/11/2026 | Ba agent triển khai theo repo; root đối chiếu contract, rà nhánh nghiệp vụ và kiểm thử Kafka/Mongo thật; sửa thêm rule AI và tình huống mở lại cùng lịch | Xem mục 9; trạng thái browser E2E vẫn chưa kiểm chứng. |

## 9. Kết quả triển khai và vận hành

### Các repo đã thay đổi

- `hs-core-api`: 9 mutation trực tiếp, auto-cancel và hai nhánh scheduler ghi `appointment_notification_outbox` cùng transaction. Writer giữ payload JSON và event ID bất biến. Publisher claim bằng PostgreSQL `FOR UPDATE SKIP LOCKED`, chặn vượt head cùng booking, gửi Kafka với key booking ID và chờ ack trước khi đánh dấu `sent_at`. Khóa appointment/listing bảo vệ mutation liên quan. Bổ sung detail endpoint và đồng bộ guard reschedule với `AppointmentActionRules` của AI.
- `hs-notification-service`: schema/template đủ 9 loại booking, side và route cố định; test replay/actionPath; cập nhật Kafka contract doc và smoke backend.
- `hs-web-app`: detail API, deep-link theo query và quyền phía nhận, safe popup link, refresh list/count/detail có coalesce và cleanup; cập nhật detail sau thao tác local. Không dùng observer title toàn head.
- `hs-infra`: broker cấu hình tắt auto-create; job bootstrap tạo cả topic Keycloak và hai topic notification, Keycloak chờ job thành công. Các topic đã có không bị xóa/tạo lại. Chưa restart broker đang chạy để áp dụng cấu hình mới.

### Verification đã chạy

| Phần | Kết quả thực tế |
|---|---|
| Core focused tests | 81 test khác nhau đạt, gồm 6 PostgreSQL thật trên DB test mới, không skip |
| PostgreSQL thật | Rollback nghiệp vụ+outbox; approve chờ khóa cancel rồi bị từ chối; gửi lỗi giữ payload/retry đúng thứ tự; hai publisher không vượt head; create với khóa listing, chặn duplicate và detail outsider; Java publisher gửi Kafka thật rồi đọc lại đúng key/payload và đánh dấu đã gửi |
| Java → Node contract | JSON thực từ writer test `hs-listing-service/target/booking-event-contract.json` được parser/template/deep-link của notification service chấp nhận |
| Notification focused tests | 34/34 đạt: event matrix, strict validation, tương thích cũ, replay/delivery/realtime payload |
| Notification build/lint | `npm run build`, `npm run lint` đạt |
| Kafka → MongoDB → REST thật | `npm run test:backend` đạt: 9 loại × 2 phía nhận, gửi lặp, route đúng và cô lập recipient; kèm các kiểm tra backend sẵn có |
| Web | 16/16 focused tests, `npx tsc --noEmit`, ESLint các file liên quan đạt |
| Infra | `docker compose -f docker-infra.yml config --quiet` đạt; đối chiếu topic/broker Core/consumer/infra local khớp, không log secrets |
| Browser hai tài khoản / push booking thật | Chưa chạy; các hàng “Chưa chạy” ở bảng mục 6 là browser/manual E2E |

Test backend chỉ tạo topic riêng `homespace.notification.test.*` và dữ liệu dưới `homespace_notification_test`; push/realtime live bị tắt trong smoke này. Test Java publisher tạo topic riêng `homespace.notification.publisher.test.*` và đọc lại một event. PostgreSQL dùng DB mới `core_booking_notification_test_20261113_0255`, không dùng DB dev cho create-drop. Không phát booking notification tới người dùng thật trong đợt test tự động.

### Chạy và thử thủ công

1. Áp dụng infra từ thư mục `hs-infra`: `docker compose -f docker-infra.yml up -d`. Đợi broker healthy và `hs-kafka-topics` exit 0. Lệnh này áp dụng cấu hình broker mới; không dùng `down -v`.
2. Restart Core và notification service; frontend dev nhận source mới. Core dev dùng JPA schema update hiện có để tạo bảng outbox mới; môi trường dùng `validate`/tắt DDL cần tạo schema qua quy trình migration trước khi chạy, không dùng create-drop trên dữ liệu thật.
3. Core có các config mới: `KAFKA_EVENTS_TOPIC` (default topic đã dùng), `NOTIFICATION_OUTBOX_ENABLED=true`, `NOTIFICATION_OUTBOX_POLL_DELAY_MS=1000`. Dù publisher bị tắt, mutation vẫn ghi outbox để gửi sau; bật lại sẽ xử lý backlog. Broker/topic local đã khớp consumer, không cần thêm secret mới.
4. Dùng A là chủ tin đăng, B là khách khác tài khoản. Tin đăng phải đang hiển thị, có ngày/khung giờ xem hợp lệ; B đáp ứng KYC hiện có. Mở dashboard lịch chủ nhà ở A và chi tiết tin ở B, bấm **Đặt lịch xem**.
5. A nhận popup góc trái; bấm mở modal đúng lịch. A duyệt → B nhận thông báo và mở lịch phía khách. Tiếp tục thử đổi giờ/từ chối/hủy bằng các lịch phù hợp, gồm bấm lại cùng lịch sau khi đóng modal.
6. Để thử push, tài khoản nhận dùng Chrome profile thường đã bật quyền và đăng ký push. Đóng tab HomeSpace, giữ Chrome hoạt động; bên kia thay đổi lịch. Push hiện nội dung chung, bấm vào trung tâm thông báo rồi mở chi tiết sau xác thực. Không dùng ẩn danh cho phía thử push.

Không cần dùng form admin broadcast để tạo thông báo booking. Booking response không chờ Kafka; notification được phát sau commit qua outbox, bình thường thêm khoảng poll 1 giây cùng thời gian broker/consumer.

### Giới hạn còn lại

- Chưa chạy browser E2E hai tài khoản, chưa đo performance Chrome sau tích hợp này, chưa thử kill process đúng cửa sổ ack/commit. Retry/dedup/locking và Java publisher với Kafka thật đã được kiểm chứng theo các lớp ở trên.
- Sent outbox rows chưa có retention/purge tự động; cần chính sách giữ lịch sử trước khi lượng dữ liệu lớn. Không xóa dữ liệu tự động trong đợt này.
- Realtime vẫn dùng room local một instance; cần shared adapter trước khi scale nhiều replica.
- Generic push không mang category nên recovery có thể refresh lịch khi push thuộc tính năng khác; các tín hiệu được coalesce và không tạo vòng lặp unread-count.
- Schema/event mới cần notification service phiên bản mới trước khi Core bắt đầu phát; consumer cũ sẽ đưa event mới vào DLT.

## 10. Bổ sung phân loại và ngữ cảnh yêu cầu (13/11/2026)

Ảnh kiểm tra thực tế cho thấy badge chỉ ghi chung “Lịch hẹn” và body không có tên tin/ngày giờ. Rà lại Core xác nhận **không thiếu loại transition**: đủ 9 loại trong mục 3, gồm auto-cancel và scheduler. Feed notification thuộc tài khoản Keycloak, không lọc theo dashboard tenant/owner; cùng tài khoản giữ hai vai trò có thể thấy yêu cầu gửi đến chủ nhà khi đang ở dashboard người thuê. Mỗi thông báo mang `recipientSide` và đường dẫn theo đúng phía nhận.

- [x] Core writer gửi thêm snapshot `listingTitle` đã lọc ký tự điều khiển/HTML, tối đa 120 ký tự; `appointmentDate` ISO và `startTime` HH:mm. Yêu cầu đổi lịch dùng ngày/giờ **đề xuất**; event khác dùng lịch hiện tại. Không gửi phone/email/note/reason.
- [x] Notification parser chỉ cho phép các field mới ở booking, validate title/ngày/giờ; event booking cũ vẫn nhận. Body mới ghi tên tin và giờ hẹn khi có đủ dữ liệu; push nền vẫn hiển thị nội dung chung.
- [x] Web hiển thị nhãn theo `item.type` cho cả dropdown và trang đầy đủ, cùng nhãn phía nhận khi có `recipientSide`. Test nhãn 2/2, TypeScript và ESLint đạt.
- [x] Core writer test 2/2 đạt; fixture JSON thật do Java sinh được notification parser/render chấp nhận với tên tin, giờ và route.
- [x] Notification focused suite 51/51, build và lint đạt. Smoke Kafka → MongoDB → REST với 9 loại × 2 phía, gửi lặp và ngữ cảnh mới đạt.
- [ ] Kiểm tra trực tiếp UI sau restart Core + notification service và tạo lịch mới. Notification đã lưu trước đó giữ body cũ; frontend phân loại bằng `type` đã lưu.

Các event ngữ cảnh mới cần notification service mới chạy trước khi Core mới phát; parser cũ sẽ đưa payload nhiều field vào DLT.
