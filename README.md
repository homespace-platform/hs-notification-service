# HomeSpace Notification Service

NestJS microservice độc lập dành cho miền thông báo của HomeSpace. Service sở hữu MongoDB `homespace_notification`, đăng ký Eureka và nhận identity đã xác thực từ API Gateway (Keycloak JWT được Gateway verify sẵn).

Yêu cầu Node.js `>=22.14.0`.

Hướng dẫn đầy đủ: [SETUP_AND_TEST.md](docs/SETUP_AND_TEST.md) — env, toàn bộ REST API, Kafka UI, realtime và Firebase. Kết quả kiểm thử: [NOTIFICATION_PROGRESS.md](docs/NOTIFICATION_PROGRESS.md). Thử gửi thông báo từ admin: [ADMIN_BROADCAST_TESTING.md](docs/ADMIN_BROADCAST_TESTING.md).

## Chạy local

```powershell
Copy-Item .env.example .env.dev
npm ci
npm run start:dev
```

Điền MongoDB, Eureka, shared secret và cấu hình Kafka trong `.env.dev`. Service lắng nghe port `8085`. Tạo source topic và DLT trước khi bật Kafka; các khóa Firebase để trống cho tới khi setup provider.

Hạ tầng local hiện có: MongoDB `localhost:27017`, Kafka `localhost:9092`, Kafka UI `localhost:9022`, Eureka `localhost:8761`. Dùng thông tin đăng nhập của môi trường bạn đang chạy.

## API qua Gateway

- Diagnostics: `GET /api/v1/notifications/ping`, `GET /api/v1/notifications/auth/me`
- Domain API hiện có: feed, unread count, read/delete và preferences dưới prefix `/api/v1/notifications/**`. Xem [tiến độ, cấu hình và test](docs/NOTIFICATION_PROGRESS.md).

Gateway bỏ `/api/v1/notifications` trước khi forward tới service trên port `8085` (`lb://hs-notification-service`).

## Endpoint kiểm tra

- Trực tiếp: `GET http://localhost:8085/ping`
- Qua Gateway: `GET http://localhost:8080/api/v1/notifications/ping`
- Có xác thực qua Gateway: `GET http://localhost:8080/api/v1/notifications/auth/me`

Các endpoint nghiệp vụ không tự verify JWT. Gateway verify JWT và chuyển identity qua `X-User-Id`, `X-User-Email`, `X-User-Name`, `X-User-Name-B64`, `X-User-Role`, `X-User-Authorities`. Notification service ưu tiên `X-User-Name-B64` để giữ nguyên tên Unicode UTF-8; `X-User-Name` được giữ làm fallback tương thích.

`EUREKA_INSTANCE_HOSTNAME=localhost` bật chế độ tự tìm IPv4 physical để đăng ký Eureka, tương đương `eureka.instance.prefer-ip-address=true` của các Java service. Có thể đặt IP/hostname cụ thể để override khi chạy trong Docker hoặc VM.
