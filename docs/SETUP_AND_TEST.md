# Notification Service — setup và kiểm thử backend

Service độc lập nhận sự kiện từ Kafka, lưu MongoDB, cung cấp REST API, Socket.IO và bộ gửi Firebase Web Push. Core API và frontend **chưa được tích hợp** trong đợt này. Hợp đồng sự kiện ở [Kafka testing](docs/KAFKA_TESTING.md) là hợp đồng cần dùng khi tích hợp producer sau này.

## 1. Cấu hình local

Sao chép `.env.example` thành `.env` nếu chưa có file cấu hình riêng. Điền các giá trị bên dưới; không ghi đè `.env` đang sử dụng. `.env.dev` được ưu tiên hơn `.env` nếu cả hai tồn tại.

| Biến | Cách điền |
|---|---|
| `MONGODB_URI` | URI MongoDB của bạn, gồm database `homespace_notification`, thông tin đăng nhập và `authSource` phù hợp. Không có mật khẩu mặc định trong file mẫu. |
| `GATEWAY_INTERNAL_SECRET` | Tự tạo chuỗi ngẫu nhiên ít nhất 32 ký tự, trùng với Gateway. Chỉ server biết giá trị này. |
| `KAFKA_ENABLED` | `true` để nhận Kafka; `false` để kiểm tra REST riêng. |
| `KAFKA_BROKERS` | Chạy Node trên Windows: `localhost:9092`; chạy trong Docker: dùng hostname/listener nội bộ được broker quảng bá. |
| `KAFKA_CLIENT_ID` | Định danh service, ví dụ `hs-notification-service`. |
| `KAFKA_GROUP_ID` | Giữ ổn định qua các lần restart để tiếp tục offset. Các replica cùng service dùng cùng group. |
| `KAFKA_EVENTS_TOPIC` | Topic nhận sự kiện, mẫu `homespace.notification.events.v1`. |
| `KAFKA_DLT_TOPIC` | Topic lỗi, mẫu `homespace.notification.events.dlt.v1`; phải khác topic nhận. |
| `KAFKA_RETRY_ATTEMPTS` | Số lần thử ghi nhận trong một lần xử lý, từ 1–10. |
| `KAFKA_RETRY_DELAY_MS` | Khoảng chờ thử lại, từ 0–10000 ms. Lỗi hạ tầng vẫn giữ offset chưa commit để phục hồi. |
| `PORT`, `SERVICE_NAME` | Mẫu `8085`, `hs-notification-service`. Gateway khám phá bằng service name này. |
| `EUREKA_CLIENT_SERVICE_URL`, `EUREKA_INSTANCE_HOSTNAME` | Địa chỉ Eureka và hostname/IP mà Gateway truy cập được. Eureka không cần cho smoke test nội bộ. |

Trong Kafka UI `http://localhost:9022`, tạo **hai topic đúng tên đã cấu hình** trước khi chạy service. Local một broker dùng replication factor 1; một partition đủ cho kiểm thử. Service không tự tạo topic nghiệp vụ. Kafka UI là công cụ quan sát/gửi bản ghi, không thay thế broker.

```powershell
npm ci
npm run build
npm run start:dev
```

Giữ Firebase và realtime ở `false` để thử luồng Kafka/MongoDB trước. Khi bật một kênh, thiếu cấu hình bắt buộc sẽ làm ứng dụng báo lỗi cấu hình. Secret và private key trong `.env.example` đều để trống; không đặt chúng trong frontend hoặc Git.

## 2. Toàn bộ REST API người dùng

Qua Gateway dùng prefix `http://localhost:8080/api/v1/notifications` và `Authorization: Bearer <Keycloak access token>`. Service port 8085 nhận path sau khi Gateway bỏ prefix. Chỉ trong kiểm thử local nội bộ mới gửi `X-Internal-Secret` và `X-User-Id` trực tiếp; trình duyệt không được biết shared secret.

| Method | Path | Payload/ghi chú |
|---|---|---|
| GET | `/ping` | Health check công khai; trả `pong`. |
| GET | `/auth/me` | Danh tính được Gateway xác thực. |
| GET | `/feed` | Query `limit` 1–50, `cursor`, `category`, `unreadOnly=true/false`. Cursor từ `result.nextCursor`. |
| GET | `/unread-count` | `result.count`. |
| PATCH | `/:id/read` | Đánh dấu đã đọc; có thể gọi lại an toàn. |
| PATCH | `/read-all` | Đánh dấu tất cả của tài khoản đang đăng nhập. |
| DELETE | `/:id` | Xóa mềm; không truy cập được thông báo của tài khoản khác. |
| GET | `/preferences` | Lấy cài đặt theo category. |
| PUT | `/preferences` | `{ "items": [{ "category": "LISTING", "push": false, "email": false }] }`. Category gửi lên là phần thay thế; category bỏ qua được đặt về mặc định bật. |
| PUT | `/devices` | `{ "installationId": "UUID-v4", "installationSecret": "chuỗi-base64url-ngẫu-nhiên-43-128-ký-tự", "fid": "Firebase-installation-ID" }`. |
| DELETE | `/devices/:installationId` | Body `{ "installationSecret": "cùng giá trị đã đăng ký" }`; gọi khi logout/tắt push. |

Category hiện có: `SYSTEM`, `ACCOUNT`, `LISTING`, `APPOINTMENT`, `CONTRACT`, `PAYMENT`, `CHAT`. Dữ liệu trả trong `result` của `ApiResponseDto`. Không có endpoint HTTP công khai tạo thông báo: producer đáng tin cậy gửi Kafka. Preferences `email` hiện chỉ lưu cấu hình, chưa có nhà cung cấp gửi email.

## 3. Thử gửi message từ Kafka UI

Đăng nhập để lấy đúng Keycloak `sub` của người nhận. Trong topic nhận → Messages → Produce Message, chọn JSON/plain text value và dùng mẫu sau. Thay recipient, dùng `eventId` mới cho hành động mới; key nên là ID nghiệp vụ để các sự kiện cùng đối tượng giữ thứ tự trong partition.

```json
{
  "eventId": "test-listing-001",
  "eventType": "LISTING_APPROVED",
  "version": 1,
  "occurredAt": "2026-11-12T09:00:00.000Z",
  "recipients": ["KEYCLOAK_USER_SUB"],
  "data": { "listingId": "listing-001" }
}
```

Gọi `/feed` và `/unread-count`: phải thấy thông báo. Gửi lại **cùng eventId**: mỗi người vẫn chỉ có một thông báo. Gửi JSON sai hoặc `version: 2`: bản ghi lỗi chuyển sang DLT, gồm tọa độ source để điều tra, không sao chép nội dung riêng tư. Nếu MongoDB lỗi, offset chưa commit để Kafka xử lý lại khi phục hồi. Không đánh đồng Kafka UI thấy bản ghi với service đã lưu thành công; kiểm tra API và consumer lag.

Các event, dữ liệu yêu cầu, lệnh publisher và cách phục hồi DLT: [docs/KAFKA_TESTING.md](docs/KAFKA_TESTING.md). Producer chịu trách nhiệm xác định người nhận có quyền; tài khoản broker chỉ cấp cho backend và người vận hành được phép.

## 4. Realtime và Firebase

Bật `NOTIFICATION_REALTIME_ENABLED=true`, điền `KEYCLOAK_ISSUER_URL` đúng realm issuer, `KEYCLOAK_AUDIENCE` đúng audience của access token và `NOTIFICATION_REALTIME_ORIGINS` là các origin cụ thể phân cách bằng dấu phẩy. Socket.IO websocket tại `http://localhost:8085/notifications`, path `/socket.io`; handshake gửi `auth.token`. Server xác minh JWT/JWKS và tự chọn room theo `sub`. Token hết hạn bị ngắt kết nối. Gateway WebSocket route chưa được bổ sung; kiểm thử trực tiếp service theo [REALTIME_TESTING.md](docs/REALTIME_TESTING.md).

Bật `PUSH_ENABLED=true` sau khi điền `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` từ service account. Xem [PUSH_SETUP.md](docs/PUSH_SETUP.md) cho Firebase Console, FID registration và thao tác kiểm thử. Không lấy private key này từ cấu hình Firebase Web công khai. Đây là FID đã đăng ký với Firebase, không phải tự tạo chuỗi để gửi push thật.

Push job được lưu MongoDB, có retry/lease và trạng thái `pending`, `processing`, `accepted`, `failed`, `skipped`. `accepted` chỉ nghĩa Firebase chấp nhận, không chứng minh trình duyệt hiển thị hay người dùng đã đọc. Nội dung push chung giúp giảm lộ dữ liệu khi nhiều tài khoản dùng chung trình duyệt. In-app vẫn được lưu khi push tắt hoặc nhà cung cấp lỗi. Socket.IO hiện chạy một replica; cần shared adapter trước khi mở nhiều replica realtime.

## 5. Kiểm thử

```powershell
npm test -- --runInBand --silent
npm run test:e2e -- --runInBand --silent
npm run build
npm run lint

# MongoDB và Kafka thật; lấy duy nhất cấu hình runtime từ .env vào process.
node --env-file=.env scripts/smoke-backend.cjs
```

Smoke test cần build trước, tạo topic ngẫu nhiên `homespace.notification.test.*` và chỉ ghi database `homespace_notification_test`. Script không xóa database/topic hiện có. Nó xác nhận Kafka → MongoDB → REST, chống trùng, quyền sở hữu, read/delete, validation, preferences và đăng ký/hủy thiết bị. Topic và dữ liệu thử được giữ để quan sát trên Kafka UI/MongoDB.

Firebase thật cần service account và browser FID đã được đăng ký; test mock không thay thế bước này. Frontend, Core API và cấu hình Gateway realtime sẽ được tích hợp ở yêu cầu sau. Kết quả đã chạy ghi ở [NOTIFICATION_PROGRESS.md](NOTIFICATION_PROGRESS.md).
