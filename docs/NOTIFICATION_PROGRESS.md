# Notification backend — báo cáo tiến độ

Cập nhật 12/11/2026. Source local, chưa commit/push. Các phase là mốc tham khảo; backend độc lập đã được ghép và kiểm thử trước khi tích hợp producer nghiệp vụ/frontend.

## Đã triển khai

- MongoDB lưu thông báo theo tài khoản, unique `(recipientId, sourceEventId)`, cursor pagination, unread count, read/read-all, soft delete, preferences. Chờ index hoàn tất trước khi nhận sự kiện.
- Kafka consumer cho 13 loại sự kiện HomeSpace, kiểm tra envelope v1 và template tiếng Việt. Commit sau khi lưu; bản ghi trùng không tạo thông báo trùng. Lỗi hạ tầng giữ offset để phục hồi, bản ghi sai chuyển DLT có tọa độ source đã lược nội dung riêng tư.
- API đăng ký/hủy browser installation, proof hash, bảo vệ chuyển tài khoản, nhiều thiết bị. Mongo lưu push jobs, recovery sau crash, lease và retry có giới hạn, kiểm tra preferences trước khi gửi.
- Firebase Admin 14.5.1 gửi tới FID đã đăng ký. Push chứa thông tin chung, trạng thái provider accepted không được coi là người dùng đã đọc.
- Socket.IO xác minh Keycloak JWT/JWKS, allowlist origin, room theo `sub`, ngắt khi token hết hạn, broadcast new/read/deleted/unread-count. Lỗi realtime không làm thao tác REST đã ghi thành công trả lỗi.
- File env mẫu đã để trống URI có credentials, shared secret và Firebase keys. [SETUP_AND_TEST.md](SETUP_AND_TEST.md) có toàn bộ biến, endpoint và cách dùng Kafka UI.

## Kết quả kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| `npm run build` | Đạt sau các thay đổi code cuối |
| `npm test -- --runInBand --silent` | 127 đạt, 6 Mongo integration bỏ qua trong lệnh mặc định vì cần URI riêng |
| `npm run test:e2e -- --runInBand --silent` | 5 đạt |
| `npm run lint` | Đạt |
| Push focused suite có Mongo thật | Agent chạy 47 ca đạt, gồm 6 ca Mongo thật; không đọc/in secrets ra log |
| Kafka broker smoke | Đạt manual commit, DLT và duplicate với persistence stub; topic thử giữ lại |
| `npm run test:backend` với Kafka + MongoDB thật | Đạt: nhận Kafka, lưu Mongo, chống trùng, API feed/count/read/read-all/delete, validation, quyền sở hữu, preferences và register/unregister installation |
| Realtime focused tests | 27 ca đạt, gồm kiểm tra JWT/JWKS và broadcast; chưa chứng nhận browser/Gateway WebSocket thật |
| `git diff --check` | Không có lỗi whitespace |

Smoke toàn backend tạo topic riêng `homespace.notification.test.*` và database `homespace_notification_test`, không xóa dữ liệu nghiệp vụ. Các bản ghi thử được giữ lại để xem bằng Kafka UI/MongoDB. KafkaJS phát cảnh báo `TimeoutNegativeWarning` không làm smoke thất bại; tiến trình đã kết thúc exit 0. Toolchain npm cũng cảnh báo Node hiện tại v24.13.1 thấp hơn yêu cầu một số package phát triển Angular (24.15+ hoặc nhánh Node được package đó hỗ trợ); build/test thực tế vẫn đạt trong môi trường này.

## Phần cần bạn setup và kiểm tra tiếp

1. Điền `.env` theo [hướng dẫn setup](SETUP_AND_TEST.md). Tạo source topic/DLT đúng tên, chạy service và gửi mẫu JSON bằng Kafka UI. Dùng `recipients` bằng Keycloak subject của tài khoản thử.
2. Kiểm tra REST qua Gateway với access token thật. Smoke tự động vừa chạy kiểm tra trực tiếp service bằng identity nội bộ, chưa thay thế kiểm thử Gateway đang chạy.
3. Bật realtime khi đã có issuer/audience/origin đúng và thử các client theo [REALTIME_TESTING.md](REALTIME_TESTING.md). Hiện chỉ hỗ trợ một replica realtime; chưa thêm shared adapter.
4. Điền Firebase server credentials và đăng ký FID thật để thử push theo [PUSH_SETUP.md](PUSH_SETUP.md).

## Chưa tích hợp nghiệp vụ chính

Không sửa Core API trong đợt backend đầu tiên; `hs-core-api` sạch tại lúc kiểm tra kết thúc. Gateway realtime route chưa được cấu hình. Email hiện chỉ có preferences, chưa có provider gửi. Chưa áp dụng chính sách tự xóa dữ liệu/retention trong MongoDB khi chưa thống nhất thời hạn lưu.

Yêu cầu tiếp theo có thể nối Core API qua transactional outbox/Kafka và frontend qua REST/realtime/push, dùng hợp đồng đã kiểm thử tại đây. Producer sẽ chịu trách nhiệm quyết định người nhận và chỉ phát sự kiện sau khi nghiệp vụ được ghi nhận chắc chắn.

## Cập nhật: Admin broadcast tới USER

- `hs-notification-service` có `POST /api/v1/notifications/admin/broadcast`; chỉ nhận identity Gateway có role `ADMIN`. Service đọc API danh sách người dùng hiện có `GET /api/v1/admin/users`, chọn `role=USER, active=true`, tạo `SYSTEM/PLATFORM_ANNOUNCEMENT` theo từng người. `broadcastId` UUIDv4 làm khóa chống trùng khi gửi lại cùng nội dung. Đây là yêu cầu admin độc lập, không thêm producer hoặc sửa Core API.
- `hs-admin-portal` có form ở **Vận hành & Hỗ trợ → Thông báo hệ thống**. `hs-web-app` đã nối REST, Socket.IO và đăng ký Firebase FID; có nút bật/tắt push. Xem [hướng dẫn thử broadcast](ADMIN_BROADCAST_TESTING.md) và hướng dẫn Firebase Web trong `hs-web-app/NOTIFICATION_BROWSER_SETUP.md`.
- `.env` local của notification service đã bật `NOTIFICATION_REALTIME_ENABLED=true`, `PUSH_ENABLED=true`, thêm `USER_DIRECTORY_URL` local. Kiểm tra validate env đạt; Firebase service account mới lấy access token thành công. Tiến trình đang nghe port 8085 đã khởi động sau lần sửa `.env` và route admin mới trả 401 khi gọi thiếu xác thực.
- Backend: 6 test mới cho admin broadcast đạt; bộ focused gồm Socket.IO đạt 7 test, build/lint đạt. Admin portal: TypeScript và ESLint đạt. Web client: TypeScript, ESLint và 2 test service worker đạt. Firebase Web app config và VAPID public key đã được điền vào `hs-web-app/.env`; project ID khớp backend. Next.js dev server ghi nhận `Reload env: .env`. Chưa thử giao diện thực tế hay push sau khi đóng tab. Chỉ dùng Chrome Profile thường để thử push, vì FCM không hoạt động trong phiên ẩn danh.
- Giới hạn hiện tại: Broadcast xử lý đồng bộ tối đa 100.000 người theo trang 100. Nếu API danh sách người dùng lỗi giữa chừng, gửi lại cùng ID/nội dung để hoàn tất; cần hàng đợi bền vững trước khi dùng ở quy mô lớn.
