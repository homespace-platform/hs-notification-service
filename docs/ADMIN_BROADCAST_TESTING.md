# Thử thông báo hệ thống từ Admin

## Cấu hình local

1. Trong `.env` của notification service, bật Kafka với topic notification hiện có và đặt `PUSH_ENABLED=true`. Realtime luôn bật. Core, Gateway và Kafka phải chạy; Core sở hữu audience và outbox.
2. Giữ `KEYCLOAK_ISSUER_URL`, `KEYCLOAK_AUDIENCE`, `NOTIFICATION_REALTIME_ORIGINS`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` đã cấu hình. Không đưa khóa riêng vào Git.
3. Khởi động lại notification service sau khi đổi `.env`; các cờ chỉ được đọc khi tiến trình khởi động. Kiểm tra dịch vụ vẫn đăng ký trong Eureka.
4. Trong `hs-web-app`, điền cấu hình Firebase Web công khai và VAPID public key theo hướng dẫn của repo đó, sau đó khởi động lại web app. Trình duyệt phải hỗ trợ FCM và bạn phải cho phép thông báo bằng thao tác của mình. Localhost được trình duyệt coi là secure context.

## Luồng thử

1. Mở `localhost:5000` và đăng nhập **tài khoản ADMIN**. Mở **Vận hành & Hỗ trợ → Thông báo hệ thống**.
2. Mở `localhost:3000` trong một **Chrome Profile thường khác** và đăng nhập **tài khoản khác có role USER, active=true**. Có thể dùng tab ẩn danh để thử Socket.IO, nhưng FCM bị tắt trong phiên ẩn danh theo [Firebase Codelab](https://firebase.google.com/codelabs/firebase-cloud-functions). Tài khoản ADMIN đăng nhập vào client sẽ không nhận broadcast USER.
3. Giữ tab USER mở, chọn mức `URGENT`, nhập tiêu đề/nội dung trên trang admin rồi gửi. Gateway chuyển `POST /api/v1/notifications/admin/broadcast` tới Core. API trả HTTP `202` với `result: {broadcastId, status: 'QUEUED'}` khi đã xếp broadcast vào hàng đợi bền vững; phản hồi chưa có nghĩa mọi người nhận đã được lưu. Chờ Core fanout/outbox → Kafka → notification-service rồi kiểm tra chuông thông báo và `GET /api/v1/notifications/feed` bằng token USER.
4. Cho phép Web Push trên tab USER, kiểm tra đăng ký thiết bị bằng `PUT /api/v1/notifications/devices` và collection `notification_devices`. Đóng tab USER nhưng giữ trình duyệt chạy, gửi **broadcast mới** từ admin. Kiểm tra thông báo hệ điều hành. Nhấn vào thông báo để mở web và kiểm tra bản ghi trong feed.
5. Kiểm tra MongoDB collection `notifications` trong DB `homespace_notification`: `category=SYSTEM`, `type=PLATFORM_ANNOUNCEMENT`, `priority` theo lựa chọn, mỗi `recipientId` đúng một bản ghi cho cùng `sourceEventId=admin_<broadcastId>`. Push delivery ở `notification_deliveries`; trạng thái `accepted` chỉ xác nhận Firebase nhận yêu cầu, không chứng minh người dùng đã xem.

## Lưu ý khi thử

- Core kiểm tra ADMIN và chọn USER đang active trong dữ liệu do Core quản lý. Notification-service không có endpoint admin broadcast, không gọi Gateway/Core để tìm người nhận và không nhận token ADMIN để phát thông báo. Lặp lại cùng `broadcastId` và nội dung dùng khóa chống trùng; không đổi nội dung khi dùng lại ID.
- Core phát `PLATFORM_ANNOUNCEMENT` v1 theo lô 1..100 người trên topic notification hiện có, `sourceEventId=admin_<broadcastId>`, data gồm đúng `{title, body, priority, actionPath}`. Consumer vẫn nhận dạng cũ `{title, body}` với priority `NORMAL` và route `/notifications`. Offset chỉ commit sau khi cả lô được lưu; retry không tạo bản ghi trùng.
- Socket.IO dành cho tab web đang mở. Firebase Web Push dành cho trình duyệt đã đăng ký, nhất là khi tab đóng. Hai kênh có thể cùng hoạt động; giao diện đồng bộ bằng feed để tránh hiển thị trùng.
- Một tài khoản USER phải được đăng ký FID trên trình duyệt thử trước khi nhận push. Chỉ điền service-account JSON ở backend chưa đủ; web cần Firebase Web app config và VAPID public key.
- News dùng luồng riêng: News → source Kafka → Core audience/outbox → targeted Kafka → notification-service; không có callback HTTP. Xem [Kafka testing](KAFKA_TESTING.md).
