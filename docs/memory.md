# HomeSpace notification — bàn giao cho AI tiếp theo

Cập nhật: 13/11/2026. Tài liệu này là ảnh chụp trạng thái **source local** để tiếp tục làm việc, không xác nhận các service hiện đang chạy. Đọc cùng [checklist đặt lịch](checklist/VIEWING_APPOINTMENT_NOTIFICATIONS.md); checklist chứa ma trận thao tác và lịch sử kiểm thử chi tiết hơn. Không coi các kết quả kiểm thử ghi dưới đây là kết quả vừa chạy trong phiên bàn giao này.

## 1. Quy tắc làm việc và trạng thái repo

- Workspace `D:/Workspace/homespace` gồm nhiều repo Git độc lập. Đọc `AGENTS.md` của workspace/repo trước khi sửa. Không tự commit, push, reset, xóa volume/database hoặc in `.env`/token/private key.
- Tại lúc rà bàn giao, các repo liên quan đều ở nhánh `master`: `hs-core-api` `4a2a3ba`, `hs-notification-service` `2cfe84b`, `hs-web-app` `a837b87`, `hs-admin-portal` `bd96c8f`, `hs-infra` `a6de4d7`. Worktree của chúng sạch trước khi viết file này; sau đó chỉ `hs-notification-service/docs/memory.md` là file mới chưa track. Kiểm tra lại Git status khi nhận việc vì người dùng có thể tiếp tục sửa.
- Đã nhờ ba sub-agent **chỉ đọc** rà Core, notification và hai frontend cho tài liệu này. Không chạy lại build/test, không khởi động service hoặc sửa dữ liệu trong lượt bàn giao.
- Ưu tiên yêu cầu mới nhất của người dùng. Phần “việc còn mở” bên dưới là trạng thái, không phải giấy phép tự ý triển khai tính năng khác.

## 2. Bức tranh hệ thống

```text
Admin portal ──POST broadcast──> Gateway ──> Notification service ──> MongoDB/feed
                                                     │                       │
                                                     ├──Socket.IO──────────> Web đang mở
                                                     └──Firebase FCM───────> Chrome đã đăng ký

Web đặt lịch ──REST──> Core API ──transactional outbox──> Kafka
                                               └────────> Notification service ──> feed/socket/push
```

- `hs-infra/docker-infra.yml` có job `kafka-topics` tạo `keycloak-user-events`, `homespace.notification.events.v1` và `homespace.notification.events.dlt.v1` bằng `--if-not-exists`. Notification consumer **không tự tạo topic**; nếu source/DLT thiếu, startup lỗi để báo infra chưa sẵn sàng. Không chuyển việc tạo topic vào service.
- `hs-notification-service` là NestJS, MongoDB, Kafka consumer, Socket.IO và Firebase Admin. REST dùng identity qua Gateway; socket tự xác minh Keycloak JWT/JWKS. Feed MongoDB là nguồn sự thật; socket và push chỉ giúp cập nhật nhanh.
- `hs-web-app` ở `localhost:3000` là client, `hs-admin-portal` ở `localhost:5000` là admin trong môi trường local đã dùng trước đây. Đừng giả định các cổng/dịch vụ đang chạy tại thời điểm nhận việc.
- Socket hoạt động khi trang đang mở và kết nối. Web push hoạt động cho Chrome profile đã cấp quyền, **đã đăng ký thiết bị**, và Chrome còn chạy khi tab HomeSpace đóng. Hai cơ chế có thể bật cùng lúc; đóng tab không tự bật push nếu chưa đăng ký. Push nền hiện có nội dung chung, không chứa thông tin lịch riêng tư.

## 3. Broadcast hệ thống từ Admin

- `hs-admin-portal/src/pages/operations/NotificationsPage.tsx` ở **Vận hành & Hỗ trợ → Thông báo hệ thống** (`/operations/notifications`). Form có mức `NORMAL`, `HIGH`, `URGENT`, tiêu đề, nội dung, bước xác nhận; gọi `POST /api/v1/notifications/admin/broadcast` qua `src/services/admin-notification.service.ts`. `AuthGuard` yêu cầu role `ADMIN`.
- Notification service chỉ nhận admin hợp lệ, gọi `GET /api/v1/admin/users` qua `USER_DIRECTORY_URL`, chọn tài khoản `role=USER, active=true`. `broadcastId` cho phép gửi lại cùng nội dung sau lỗi giữa chừng mà không tạo trùng các người đã nhận. Hiện xử lý đồng bộ theo trang 100, tối đa 100.000 người; cần thiết kế job bền vững trước khi dùng ở quy mô lớn.
- Broadcast lưu `SYSTEM/PLATFORM_ANNOUNCEMENT` cho từng người; UI client nhận qua feed/socket/push. Không dùng form này để giả lập event đặt lịch. Xem [ADMIN_BROADCAST_TESTING.md](ADMIN_BROADCAST_TESTING.md).
- Admin portal hiện **chỉ gửi** broadcast; trang cài đặt thông báo của admin mới giữ checkbox local, chưa nối backend/persistence, và admin chưa có socket/push nhận thông báo.

## 4. Tích hợp đặt lịch xem phòng

### Core: điểm phát và tính nhất quán

- `hs-core-api/hs-listing-service/.../ViewingAppointmentService.java` phát thông báo cho mọi transition nghiệp vụ: khách đặt lịch → chủ nhà; chủ nhà duyệt/từ chối → khách; khách yêu cầu đổi lịch → chủ nhà; chủ nhà duyệt/từ chối đổi lịch → khách; một bên hủy → bên kia; chủ nhà hoàn tất → khách. Auto-cancel khi tin đăng không còn khả dụng và scheduler expire/complete cũng được bao phủ; với event hệ thống gửi cho cả hai phía khi phù hợp. Không có auto-reject các lịch khác cùng khung giờ khi duyệt một lịch.
- Có **9 `BOOKING_*` event types**: `REQUESTED`, `CONFIRMED`, `REJECTED`, `RESCHEDULE_REQUESTED`, `RESCHEDULE_APPROVED`, `RESCHEDULE_REJECTED`, `CANCELLED`, `COMPLETED`, `EXPIRED` (đều có tiền tố `BOOKING_`). Rà soát mới nhất không thấy transition type còn thiếu.
- `AppointmentNotificationWriter.java` ghi payload vào bảng `appointment_notification_outbox` trong cùng transaction với booking. Publisher claim bằng PostgreSQL lock, giữ thứ tự theo booking, gửi Kafka với key booking ID, đợi acknowledgement rồi mới đánh dấu sent. Lỗi broker không làm mất event đã lưu; consumer dùng event ID để chống trùng. Mutation cạnh tranh đã có khóa; detail endpoint kiểm tra chỉ owner/renter được xem.
- `data` booking gồm `bookingId`, `recipientSide: OWNER | RENTER`, và ba field tùy chọn `listingTitle`, `appointmentDate` (`YYYY-MM-DD`), `startTime` (`HH:mm`). Title được làm sạch/giới hạn 120 ký tự. `BOOKING_RESCHEDULE_REQUESTED` dùng ngày/giờ **đề xuất**, event khác dùng lịch hiện tại. Không truyền điện thoại, email, lý do/note vào event.
- Core config: `KAFKA_EVENTS_TOPIC` mặc định `homespace.notification.events.v1`, `NOTIFICATION_OUTBOX_ENABLED=true`, `NOTIFICATION_OUTBOX_POLL_DELAY_MS=1000`. Tắt publisher không ngăn ghi outbox; bật lại sẽ xử lý backlog. Môi trường không dùng JPA schema update cần migration cho bảng outbox trước khi chạy.

### Notification: contract và delivery

- `src/modules/notification-events/notification-event.ts` nhận envelope v1 nghiêm ngặt, có template tiếng Việt đủ 9 event. `recipientSide` quyết định route cố định: chủ nhà `/dashboard/viewing-schedules?appointmentId=<id>`, người thuê `/dashboard/viewing-schedules/my-bookings?appointmentId=<id>`. Event cũ chỉ có `bookingId` vẫn hợp lệ và mở `/notifications`.
- Với event mới, body thêm tên tin và ngày/giờ khi dữ liệu hợp lệ. Push nền vẫn là tín hiệu chung. Schema mới yêu cầu **notification service mới chạy trước Core mới**: consumer cũ sẽ từ chối payload có field mới và đưa vào DLT.
- Kafka consumer kiểm tra cả source/DLT khi `KAFKA_ENABLED`; chỉ commit sau xử lý thành công hoặc ghi DLT cho dữ liệu sai. Lỗi hạ tầng giữ offset để thử lại. DLT chỉ chứa tọa độ nguồn, lý do và hash; không copy nội dung riêng tư. MongoDB dedup theo `(recipientId, sourceEventId)` và chỉ emit `notification:new` khi tạo mới. Xem [KAFKA_TESTING.md](KAFKA_TESTING.md).
- REST: feed/cursor, unread count, read/read-all, delete mềm, preferences; `PUT/DELETE /devices` đăng ký/hủy browser installation. Realtime namespace `/notifications`, Engine.IO path `/socket.io`, chỉ WebSocket; JWT kiểm tra issuer/audience/origin, room theo Keycloak `sub`, ngắt khi token hết hạn. Room chỉ nằm trong một instance; phải có shared adapter trước khi scale nhiều replica. Xem [REALTIME_TESTING.md](REALTIME_TESTING.md).
- Push dùng Firebase Admin và jobs lưu MongoDB, retry/recovery; provider accepted không có nghĩa người dùng đã đọc. Server cần service account trong env, web cần Firebase Web config/VAPID public key và người dùng tự bật quyền. Không ghi các giá trị này vào tài liệu/Git. Xem [PUSH_SETUP.md](PUSH_SETUP.md).

### Web: nơi nhận và điều hướng

- `components/auth/Providers.tsx` mount `NotificationTransport` toàn app. Transport nối socket, hiện popup realtime **góc dưới trái** (tối đa 3, khoảng 8 giây), cập nhật badge/title, refetch khi reconnect/focus/push; toast CRUD độc lập vẫn ở góc trên phải.
- `services/notification.service.ts` chứa feed/count/read/delete/preferences và helper phân loại 9 `BOOKING_*` theo `item.type`. `NotificationDropdown.tsx` và `app/notifications/page.tsx` đã hiển thị badge riêng như “Đặt mới”, “Đổi lịch”, “Đã hủy”, cùng dòng “Vai trò chủ nhà/người thuê” từ `metadata.recipientSide`. Bộ lọc vẫn là nhóm `APPOINTMENT`/“Lịch hẹn”. **Popup realtime hiện còn hiển thị nhãn nhóm từ `getCategoryMeta(item.category)`**, chưa dùng badge con theo type; chỉ mở rộng nếu yêu cầu UI cần nhất quán ở popup.
- Feed gắn với **Keycloak account**, không lọc theo dashboard owner/tenant. Một tài khoản có cả hai vai trò có thể thấy thông báo dành cho chủ nhà ngay khi mở dashboard người thuê; side label và `actionPath` giúp phân biệt. Đây không tự nó là gửi sai người.
- `components/appointment/useAppointmentDeepLink.ts` cùng hai dashboard `/dashboard/viewing-schedules` và `/dashboard/viewing-schedules/my-bookings` mở detail bằng `appointmentId`, gọi detail API có kiểm tra quyền, hỗ trợ click nhiều thông báo liên tiếp trên cùng route; `useAppointmentNotifications` refresh list/detail khi nhận tín hiệu. Trạng thái thật lấy lại từ Core, không tin trạng thái cũ trong notification.
- `services/notification-push.service.ts` đăng ký FCM/browser device khi user bật trong `components/settings/sections/NotificationsSection.tsx`; logout hủy đăng ký. `public/firebase-messaging-sw.js` hiện OS notification chung khi không có tab hiển thị, click mở `/notifications`; không chứa nội dung riêng tư. Firebase Web env names có trong `hs-web-app/.env.example`.

## 5. Cấu hình: tên biến cần biết, không sao chép giá trị

- Infra: `KAFKA_EVENTS_TOPIC`, `KAFKA_DLT_TOPIC`, `KEYCLOAK_KAFKA_TOPIC`, `KAFKA_BOOTSTRAP_SERVER`. Job topic thuộc `hs-infra/docker-infra.yml`; sau mất volume chạy `docker compose -f docker-infra.yml up -d` trong `hs-infra`, đợi `hs-kafka-topics` thành công. **Không dùng `down -v` để thử.**
- Notification: `KAFKA_ENABLED`, `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`, `KAFKA_EVENTS_TOPIC`, `KAFKA_DLT_TOPIC`, `NOTIFICATION_REALTIME_ENABLED`, `KEYCLOAK_ISSUER_URL`, `KEYCLOAK_AUDIENCE`, `NOTIFICATION_REALTIME_ORIGINS`, `PUSH_ENABLED`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `MONGODB_URI`, `GATEWAY_INTERNAL_SECRET`, `USER_DIRECTORY_URL`. `src/config/environment.validation.ts` kiểm tra yêu cầu theo tính năng bật.
- Web: `NEXT_PUBLIC_NOTIFICATION_SOCKET_URL`, `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_VAPID_KEY`; xem `.env.example` và `NOTIFICATION_BROWSER_SETUP.md`. Chỉ VAPID **public** key nằm ở frontend; service-account private key ở backend.
- Nếu cập nhật `.env`, phải restart process tương ứng. Không suy ra trạng thái runtime từ việc file có giá trị. Keycloak realm/audience cần đúng với JWT thực tế; không tắt xác minh JWT để debug.

## 6. Bằng chứng kiểm tra đã có và phần chưa xác minh

Các kết quả dưới đây từ các lượt triển khai trước, có ghi trong checklist; **phiên tạo memory chỉ đọc source/Git status**:

| Phạm vi | Kết quả đã ghi nhận |
|---|---|
| Core | 81 focused tests đạt, gồm PostgreSQL test cho rollback/lock/outbox; lần bổ sung snapshot gần nhất `AppointmentNotificationWriterTest` 2/2 đạt; fixture JSON do Java sinh được parser notification nhận. |
| Notification | Focused suite gần nhất 51/51, `npm run build`, lint đạt; `npm run test:backend` đi Kafka → MongoDB → REST qua 9 loại × 2 phía, replay/dedup và body ngữ cảnh đạt. |
| Web | 16 focused tests ở đợt booking ban đầu; test nhãn booking gần nhất 2/2, `npx tsc --noEmit` và ESLint file liên quan đạt. |
| Infra | Compose config đã từng đạt; tên topic giữa infra/Core/consumer đã đối chiếu. |

- **Chưa kiểm tra trực tiếp** luồng đặt lịch mới với hai tài khoản thật trên Chrome sau khi restart Core + notification service; chưa chứng nhận Chrome push booking khi đóng tab, deep-link liên tiếp và dashboard refresh trên môi trường của người dùng. Checklist mục 6 có bảng kịch bản và cột kết quả còn “Chưa chạy”.
- Notification cũ đã lưu vẫn có body cũ; frontend mới phân loại được theo `type` đã lưu. Ngữ cảnh tên tin/ngày giờ chỉ có với event mới sau khi hai service dùng phiên bản mới.
- Chưa thử kill process đúng cửa sổ Kafka ack/DB mark sent; outbox retry/dedup đã có test ở các lớp khác. Realtime nhiều replica, retention outbox và broadcast lớn chưa được giải quyết.
- Có tài liệu cũ [NOTIFICATION_PROGRESS.md](NOTIFICATION_PROGRESS.md) mô tả giai đoạn backend chưa nối Core; đoạn “Chưa tích hợp nghiệp vụ chính” ở đó **đã lỗi thời**. Dùng checklist đặt lịch và source hiện tại làm nguồn trạng thái mới hơn.

## 7. Cách tiếp tục an toàn

1. Xác nhận yêu cầu mới của người dùng và `git status` từng repo chịu ảnh hưởng. Đọc file liên quan trong tài liệu này, checklist và source trước khi sửa; không quét toàn workspace nếu không cần.
2. Nếu tiếp tục nghiệm thu booking: kiểm tra infra topics/DB, chạy notification service mới trước Core mới, mở hai Chrome profile/tài khoản khác nhau; thực hiện đặt → duyệt/từ chối → đổi lịch → hủy, kiểm tra popup, badge, body, route/detail và refresh. Sau đó thử đóng tab client nhưng giữ Chrome chạy với tài khoản đã đăng ký push. Ghi **kết quả thực tế** vào bảng mục 6 của checklist; đừng đánh dấu đạt chỉ vì test tự động đã chạy.
3. Khi cần sửa: xác định repo sở hữu thay đổi, giữ contract Core ↔ Kafka ↔ notification ↔ web tương thích; thêm focused regression test cho logic mới; kiểm tra cả quyền người nhận, retry/dedup và deep-link. Nếu sửa envelope, cập nhật fixture/test và [KAFKA_TESTING.md](KAFKA_TESTING.md).
4. Không xóa dữ liệu dev để “làm sạch” test. Smoke backend dùng topic/DB test tách biệt; test manual dùng tài khoản và tin đăng thử, tránh gửi broadcast hàng loạt ngoài phạm vi người dùng cho phép.

## 8. Điểm vào source khi nhận việc

| Repo | File cần mở theo loại việc |
|---|---|
| Core booking | `hs-listing-service/src/main/java/com/hs/listing/service/ViewingAppointmentService.java`, `ViewingAppointmentScheduler.java`; `hs-api-service/src/main/java/com/hs/api/controller/listing/ViewingAppointmentController.java` |
| Core event/outbox | `hs-listing-service/src/main/java/com/hs/listing/notification/AppointmentNotificationWriter.java`, `AppointmentNotificationPublisher.java`, `AppointmentNotificationOutbox.java`, `AppointmentNotificationOutboxRepository.java`; `hs-api-service/src/main/resources/application.properties` |
| Notification Kafka/API | `src/modules/notification-events/notification-event.ts`, `notification-events.consumer.ts`; `src/modules/notification/presentation/notification.controller.ts`, `admin-broadcast.controller.ts`; `src/modules/notification/application/admin-broadcast.service.ts` |
| Notification push | `src/modules/notification-delivery/device.controller.ts`, `notification-delivery.service.ts`; `src/config/environment.validation.ts` |
| Web nhận thông báo | `components/notification/NotificationTransport.tsx`, `NotificationDropdown.tsx`; `app/notifications/page.tsx`; `services/notification.service.ts`, `notification-push.service.ts`; `public/firebase-messaging-sw.js` |
| Web mở lịch | `components/appointment/useAppointmentDeepLink.ts`, `useAppointmentNotifications.ts`; `app/dashboard/viewing-schedules/page.tsx`, `app/dashboard/viewing-schedules/my-bookings/page.tsx` |
| Admin gửi broadcast | `src/pages/operations/NotificationsPage.tsx`, `src/services/admin-notification.service.ts` trong `hs-admin-portal` |

Các đường dẫn trong bảng là tương đối với repo ghi ở cột đầu; riêng Core nằm trong `hs-core-api`, các hàng Notification nằm trong `hs-notification-service`, các hàng Web nằm trong `hs-web-app`.

## 9. Prompt gửi nguyên văn cho AI tiếp theo

> Bạn tiếp tục dự án HomeSpace tại `D:/Workspace/homespace`. Trước tiên đọc `AGENTS.md` và `hs-notification-service/docs/memory.md`, rồi đọc `hs-notification-service/docs/checklist/VIEWING_APPOINTMENT_NOTIFICATIONS.md` ở phần liên quan. Mỗi `hs-*` là một repo Git độc lập. Kiểm tra Git status trước khi sửa; không reset/commit/push, không in hoặc commit `.env`, token, Firebase private key. Hệ thống đã có admin broadcast và luồng đặt lịch Core → transactional outbox → Kafka → notification → web; 9 loại BOOKING_* đã được bao phủ. Ưu tiên yêu cầu mới nhất của tôi, không làm lại phần đã hoàn tất. Nếu tôi yêu cầu nghiệm thu đặt lịch, thực hiện các kịch bản browser hai tài khoản và push còn đánh dấu chưa chạy trong checklist, ghi kết quả thật; nếu gặp lỗi thì sửa đúng repo và chạy focused tests. Giữ notification service mới chạy trước Core mới khi thử payload booking có thêm ngữ cảnh. Báo rõ thay đổi, kiểm chứng thực tế và phần còn chưa xác minh.
