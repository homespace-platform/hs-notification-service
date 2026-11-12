# Browser push backend

## Bắt đầu lần đầu — lưu toàn bộ service account vào env

Làm lần lượt từng bước. Bạn có thể dừng sau mỗi bước; chưa cần bật push ngay.

### Bước 1: Tạo project Firebase

1. Mở https://console.firebase.google.com/ và đăng nhập Google.
2. Chọn **Create a project / Tạo dự án** (hoặc **Add project**).
3. Đặt tên dễ nhận biết, ví dụ `HomeSpace Dev`.
4. Nếu được hỏi Google Analytics, có thể tắt cho lần setup thông báo này.
5. Hoàn tất tạo project và mở trang tổng quan của project đó.

### Bước 2: Tải khóa dành cho server

1. Bên cạnh **Project Overview**, bấm biểu tượng bánh răng.
2. Chọn **Project settings / Cài đặt dự án**.
3. Chọn tab **Service accounts / Tài khoản dịch vụ**.
4. Trong phần Firebase Admin SDK, bấm **Generate new private key**.
5. Xác nhận **Generate key**. Trình duyệt tải xuống một file `.json`.

Đây là file bí mật của server. Giữ ở thư mục riêng ngoài Git; không gửi file hoặc nội dung private key qua chat. Nếu tổ chức chặn tạo khóa, cần quản trị viên kiểm tra chính sách thay vì bỏ qua cảnh báo.

### Bước 3: Nhận diện các trường trong JSON

Mở file JSON bằng trình soạn thảo trên máy. Team điền toàn bộ các trường vào env một lần theo bảng dưới. Push hiện dùng `project_id`, `client_email`, `private_key`; các trường còn lại được lưu sẵn cho nhu cầu sau này.

| Trường trong JSON | Biến trong Notification Service |
|---|---|
| `type` | `FIREBASE_TYPE` |
| `project_id` | `FIREBASE_PROJECT_ID` |
| `private_key_id` | `FIREBASE_PRIVATE_KEY_ID` |
| `private_key` | `FIREBASE_PRIVATE_KEY` |
| `client_email` | `FIREBASE_CLIENT_EMAIL` |
| `client_id` | `FIREBASE_CLIENT_ID` |
| `auth_uri` | `FIREBASE_AUTH_URI` |
| `token_uri` | `FIREBASE_TOKEN_URI` |
| `auth_provider_x509_cert_url` | `FIREBASE_AUTH_PROVIDER_X509_CERT_URL` |
| `client_x509_cert_url` | `FIREBASE_CLIENT_X509_CERT_URL` |
| `universe_domain` | `FIREBASE_UNIVERSE_DOMAIN` |

Không lấy `private_key_id` thay cho `private_key`. `client_email` là địa chỉ tài khoản dịch vụ trong JSON, không phải Gmail đăng nhập của bạn.

### Bước 4: Điền file env trên máy

Mở `D:\Workspace\homespace\hs-notification-service\.env` (nếu đang dùng `.env.dev`, sửa file đó vì nó được ưu tiên). Thêm hoặc cập nhật:

```dotenv
PUSH_ENABLED=false
FIREBASE_TYPE=
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=
FIREBASE_CLIENT_ID=
FIREBASE_AUTH_URI=
FIREBASE_TOKEN_URI=
FIREBASE_AUTH_PROVIDER_X509_CERT_URL=
FIREBASE_CLIENT_X509_CERT_URL=
FIREBASE_UNIVERSE_DOMAIN=
```

Với các trường thông thường, điền giá trị từ JSON, bỏ dấu phẩy cuối dòng. Với private key, sao chép **toàn bộ chuỗi giá trị cùng cặp dấu ngoặc kép**, từ `"-----BEGIN PRIVATE KEY-----\n` tới `-----END PRIVATE KEY-----\n"`, đặt sau dấu `=`. Giữ nguyên các ký tự `\n`; bỏ dấu phẩy ở cuối dòng JSON. Không dán tên trường `"private_key":` vào env. Chưa đổi `PUSH_ENABLED` thành `true` ở bước này.

Đây là toàn bộ **service-account JSON**, chưa bao gồm cấu hình Firebase Web/VAPID lấy từ màn hình khác khi tích hợp frontend. Khi tạo lại khóa, cập nhật `FIREBASE_PRIVATE_KEY_ID` và `FIREBASE_PRIVATE_KEY` cùng lần. Mỗi môi trường nên dùng thông tin của project tương ứng; team chia sẻ file mẫu, còn giá trị bí mật lưu ở `.env` riêng hoặc secret manager.

### Bước 5: Kiểm tra Cloud Messaging

Trong **Project settings → Cloud Messaging**, kiểm tra **Firebase Cloud Messaging API (V1)** đã bật. Nếu Console đưa liên kết quản lý API, mở đúng Google Cloud project và bật API theo hướng dẫn. Phần Web Push certificate/VAPID dành cho trình duyệt sẽ làm khi nối frontend; không dùng VAPID thay cho ba biến server ở trên.

Khi các biến đã điền và API đã bật, đổi `PUSH_ENABLED=true`, lưu file và khởi động lại Notification Service. Khởi động thành công chưa chứng minh đã gửi được push: cần browser FID được đăng ký để kiểm tra gửi thật ở bước tiếp theo.

Tham khảo chính thức: [Firebase Admin — tạo service account key](https://firebase.google.com/docs/admin/setup), [Firebase Web Cloud Messaging](https://firebase.google.com/docs/cloud-messaging/web/get-started).

Push is optional and off by default. The in-app feed is persisted first, independently of Firebase availability and push preferences. Email preferences remain stored; this service does not send email.

## Server configuration

Install the locked dependencies (`npm ci`). This implementation was checked against `firebase-admin` 14.5.1 and its typed `fid` message target. Configure only in a local secret store/environment:

```dotenv
PUSH_ENABLED=false
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

Enable the Firebase Cloud Messaging HTTP v1 API and registration API in the chosen Firebase project. Create a service account with permission to send messages; place its project ID, client email, and private key in these environment keys. `FIREBASE_PRIVATE_KEY` accepts actual newlines or escaped `\n`. Set `PUSH_ENABLED=true` only after filling all three keys. Never place server credentials in a browser bundle or commit a credential file. The private VAPID key is managed by Firebase and is not supplied to this server.

## Device REST contract v1

Routes are behind the existing trusted Gateway authentication guard, mounted under the Gateway's `/api/v1/notifications` prefix. No request accepts a user/recipient ID. The Gateway must strip incoming identity headers and provide authenticated identity using its shared secret. Direct service access must remain restricted.

`PUT /devices` registers or refreshes one installation:

```json
{
  "installationId": "browser-generated UUID v4",
  "installationSecret": "browser-generated 32 cryptographically random bytes encoded base64url",
  "fid": "FCM-registered 22-character Firebase Installation ID"
}
```

Create and persist the UUID and random secret once per browser installation (e.g. `crypto.randomUUID()` and `crypto.getRandomValues(new Uint8Array(32))`, base64url encode without padding). The proof secret is unrelated to Firebase server credentials; do not use a user ID, Firebase API key, or FID as the secret. The server stores only its SHA-256 hash. The secret must remain local and travel over HTTPS. A lost proof requires a fresh browser/Firebase installation; it cannot take over the old binding. A FID is globally unique in this server's device registry.

`DELETE /devices/:installationId` with body `{"installationSecret":"..."}` disables only the authenticated user's matching installation. It is idempotent. Call and await this before logout. When switching accounts on a shared browser, register the same installation and proof under the new authenticated account before enabling that account's notification UI. This rotates its binding generation and invalidates queued jobs for the previous account. A delayed logout request from the old account cannot disable the new owner's binding. Register again on every successful FCM registration callback and on authenticated startup. Device registration does not generate pushes for historical notifications.

The server sends a generic Vietnamese notification and `data.event=notifications.changed`, with no notification ID, recipient, title, body, metadata, or action path. The browser fetches its authenticated feed; it must never display cached previous-account content. A push already accepted by Firebase can still arrive after logout/account switching, which is why its content is generic. Provider acceptance is recorded as `accepted`; it is never treated as device delivery or a read receipt.

## Current Firebase client contract

Official Firebase documentation checked 2026-11-12 recommends FIDs and deprecates registration tokens. Use a Firebase Web SDK release exposing `register()` and `onRegistered()` from `firebase/messaging`. Request browser notification permission, configure an HTTPS service worker (`firebase-messaging-sw.js` or explicit registration), generate a Web Push certificate in Firebase, and pass its **public** VAPID key to `register(messaging, {vapidKey})`. Send the FID from `onRegistered(messaging, callback)` to this endpoint. Merely calling Firebase Installations `getId()` does not register messaging; a bare FID is insufficient. Do not mix legacy `getToken()` registration with FID registration. The DTO intentionally accepts only FIDs, not legacy FCM tokens. Frontend integration is outside this backend change.

Sources: [Web setup and registration](https://firebase.google.com/docs/cloud-messaging/web/get-started), [Admin sends using FID](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk), [registration management](https://firebase.google.com/docs/cloud-messaging/manage-tokens).

## Persistence and retries

Mongo `notifications` rows serve as a recoverable outbox until `pushQueuedAt` is written. The dispatcher scans batches of 100 every five seconds, including notifications inserted before the dispatcher starts. Each notification/installation pair has a unique Mongo delivery row. Jobs are inserted before marking the outbox complete, so a crash or partial insert safely repeats enqueue. Only devices bound before notification creation are eligible. Push preferences are rechecked at send time; disabled categories become `skipped`. Device ownership, generation, activity and notification deletion are also rechecked. A category disabled at send time is not replayed when re-enabled later.

Sending is sequential in batches of 50, leased atomically for two minutes, and retried at most five times with 1/2/4/8 minute delays. Known unregistered/invalid registration errors disable that binding. Failed jobs stay inspectable; there is no automatic infinite replay of failed sends. While the provider is explicitly disabled, pending jobs remain durable and attempts do not increase. Missing credentials prevent enablement in server configuration. Never log FIDs, proof values, private keys, or raw provider errors.

Delivery is at least once: a crash after Firebase accepts a message but before Mongo records acceptance can send a duplicate. The generic Web Push tag coalesces visible notifications. A crash on the final leased attempt eventually marks the job failed; provider acceptance cannot be inferred. Mongo indexes must be created before accepting traffic (Nest/Mongoose initializes model indexes; the dispatcher creates its recovery index at startup). This feature adds no broker requirement for push delivery.

## Verification

Unit tests run with `npm test -- --runInBand src/modules/notification-delivery`. Mongo integration cases require an explicitly provided `TEST_MONGODB_URI` with permission to create/drop a **test** database. Tests always create an isolated `notification_push_test_<random>` database and drop only that database on completion. They never read `.env` themselves. Cover multi-device deduplication, recovery, ownership/proof, account switching, preference changes, disabled provider, bounded retry, invalid registrations, and preservation of unread in-app rows.

A real Firebase send and browser receive test requires configured credentials, permission, service worker, and a registered FID. Those external steps cannot be certified using a mocked provider.
