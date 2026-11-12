# Thử thông báo hệ thống từ Admin

## Cấu hình local

1. Trong `.env` của notification service, đặt `NOTIFICATION_REALTIME_ENABLED=true`, `PUSH_ENABLED=true` và `USER_DIRECTORY_URL=http://localhost:8080/api/v1/admin/users`.
2. Giữ `KEYCLOAK_ISSUER_URL`, `KEYCLOAK_AUDIENCE`, `NOTIFICATION_REALTIME_ORIGINS`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` đã cấu hình. Không đưa khóa riêng vào Git.
3. Khởi động lại notification service sau khi đổi `.env`; các cờ chỉ được đọc khi tiến trình khởi động. Kiểm tra dịch vụ vẫn đăng ký trong Eureka.
4. Trong `hs-web-app`, điền cấu hình Firebase Web công khai và VAPID public key theo hướng dẫn của repo đó, sau đó khởi động lại web app. Trình duyệt phải hỗ trợ FCM và bạn phải cho phép thông báo bằng thao tác của mình. Localhost được trình duyệt coi là secure context.

## Luồng thử

1. Mở `localhost:5000` và đăng nhập **tài khoản ADMIN**. Mở **Vận hành & Hỗ trợ → Thông báo hệ thống**.
2. Mở `localhost:3000` trong một **Chrome Profile thường khác** và đăng nhập **tài khoản khác có role USER, active=true**. Có thể dùng tab ẩn danh để thử Socket.IO, nhưng FCM bị tắt trong phiên ẩn danh theo [Firebase Codelab](https://firebase.google.com/codelabs/firebase-cloud-functions). Tài khoản ADMIN đăng nhập vào client sẽ không nhận broadcast USER.
3. Giữ tab USER mở, chọn mức `URGENT`, nhập tiêu đề/nội dung trên trang admin rồi gửi. Endpoint là `POST /api/v1/notifications/admin/broadcast`. API trả `broadcastId` và `recipientCount` khi đã tạo thông báo cho các USER lấy từ API danh sách người dùng hiện có. Kiểm tra chuông thông báo và `GET /api/v1/notifications/feed` bằng token USER.
4. Cho phép Web Push trên tab USER, kiểm tra đăng ký thiết bị bằng `PUT /api/v1/notifications/devices` và collection `notification_devices`. Đóng tab USER nhưng giữ trình duyệt chạy, gửi **broadcast mới** từ admin. Kiểm tra thông báo hệ điều hành. Nhấn vào thông báo để mở web và kiểm tra bản ghi trong feed.
5. Kiểm tra MongoDB collection `notifications` trong DB `homespace_notification`: `category=SYSTEM`, `type=PLATFORM_ANNOUNCEMENT`, `priority` theo lựa chọn, mỗi `recipientId` đúng một bản ghi cho cùng `sourceEventId=admin_<broadcastId>`. Push delivery ở `notification_deliveries`; trạng thái `accepted` chỉ xác nhận Firebase nhận yêu cầu, không chứng minh người dùng đã xem.

## Lưu ý khi thử

- Backend tra cứu role từ `GET /api/v1/admin/users` qua Gateway bằng token ADMIN hiện tại. Core API và Gateway phải chạy; endpoint này không thêm code vào Core API. Nếu API trả lỗi giữa chừng, gửi lại **cùng `broadcastId` và nội dung** để hoàn tất mà không tạo trùng cho những USER đã nhận.
- Socket.IO dành cho tab web đang mở. Firebase Web Push dành cho trình duyệt đã đăng ký, nhất là khi tab đóng. Hai kênh có thể cùng hoạt động; giao diện đồng bộ bằng feed để tránh hiển thị trùng.
- Một tài khoản USER phải được đăng ký FID trên trình duyệt thử trước khi nhận push. Chỉ điền service-account JSON ở backend chưa đủ; web cần Firebase Web app config và VAPID public key.
- Broadcast hiện xử lý đồng bộ theo từng trang 100 người, tối đa 1000 trang. Đây là giới hạn cho giai đoạn thử; cần hàng đợi broadcast bền vững trước khi dùng cho lượng người dùng lớn.
