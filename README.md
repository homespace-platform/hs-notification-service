# HomeSpace Notification Service

NestJS microservice độc lập dành cho miền thông báo của HomeSpace. Service sở hữu MongoDB `homespace_notification`, đăng ký Eureka và nhận identity đã xác thực từ API Gateway (Keycloak JWT được Gateway verify sẵn).

Yêu cầu Node.js `>=22.14.0`.

## Chạy local

```powershell
Copy-Item .env.example .env.dev
npm install
npm run start:dev
```

Điền MongoDB và Eureka trong `.env.dev`. Service lắng nghe port `8085`.

Yêu cầu MongoDB tại `localhost:27017` và Eureka tại `localhost:8761`. Có thể drop database riêng khi reset local:

```bash
mongosh "mongodb://homespace:homespace123@localhost:27017/?authSource=admin" --eval "db.getSiblingDB('homespace_notification').dropDatabase()"
```

## API qua Gateway

- Diagnostics: `GET /api/v1/notifications/ping`, `GET /api/v1/notifications/auth/me`
- Domain API (sẽ bổ sung sau): dưới prefix `/api/v1/notifications/**`

Gateway bỏ `/api/v1/notifications` trước khi forward tới service trên port `8085` (`lb://hs-notification-service`).

## Endpoint kiểm tra

- Trực tiếp: `GET http://localhost:8085/ping`
- Qua Gateway: `GET http://localhost:8080/api/v1/notifications/ping`
- Có xác thực qua Gateway: `GET http://localhost:8080/api/v1/notifications/auth/me`

Các endpoint nghiệp vụ không tự verify JWT. Gateway verify JWT và chuyển identity qua `X-User-Id`, `X-User-Email`, `X-User-Name`, `X-User-Name-B64`, `X-User-Role`, `X-User-Authorities`. Notification service ưu tiên `X-User-Name-B64` để giữ nguyên tên Unicode UTF-8; `X-User-Name` được giữ làm fallback tương thích.

`EUREKA_INSTANCE_HOSTNAME=localhost` bật chế độ tự tìm IPv4 physical để đăng ký Eureka, tương đương `eureka.instance.prefer-ip-address=true` của các Java service. Có thể đặt IP/hostname cụ thể để override khi chạy trong Docker hoặc VM.
