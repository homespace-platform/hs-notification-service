# Gửi email qua Resend

Giai đoạn 1: service đã có nền tảng gửi email (`EmailProvider.sendEmail` trong `notification-delivery`). Chưa có email nghiệp vụ nào.

## Biến môi trường

| Biến | Ý nghĩa |
| --- | --- |
| `MAIL_RESEND_API_KEY` | API key Resend (bí mật). Để trống thì kênh email bị tắt, service vẫn khởi động và ghi một dòng log cảnh báo. |
| `MAIL_FROM_ADDRESS` | Địa chỉ gửi, phải thuộc domain đã verify. Bắt buộc khi có API key. |
| `MAIL_FROM_NAME` | Tên hiển thị, gửi dưới dạng `Tên <địa chỉ>`. Bắt buộc khi có API key. |
| `MAIL_APP_BASE_URL` | Origin công khai của web (vd `https://homespace.id.vn`, không có `/` cuối): dùng cho logo, nút CTA và link cài đặt trong email. Bắt buộc khi có API key. |
| `CORE_INTERNAL_BASE_URL` | Địa chỉ nội bộ của hs-core-api (vd `http://hs-core-api:8080`) để tra email người nhận qua `/internal/users/emails`. Bắt buộc khi có API key. |

`compose.production.yml` truyền cả năm biến; đặt chúng trong Dokploy.

## Kiểm tra domain

Vào Resend dashboard, mục Domains, domain gửi phải ở trạng thái **Verified** (SPF/DKIM đúng). Chưa verify thì Resend trả 4xx (lỗi không thử lại).

## Gửi thử

```
npm run build
npm run mail:test -- you@example.com
```

Script đọc `.env` (hoặc biến môi trường) và in id Resend hoặc thông báo lỗi.

## Lỗi và giới hạn

- 4xx (sai key, domain chưa verify, dữ liệu sai): lỗi không thử lại (`retryable=false`), kèm message của Resend.
- 429, 5xx, timeout (10 giây), lỗi mạng: lỗi có thể thử lại (`retryable=true`).
- Log chỉ ghi địa chỉ đã che (`a***@domain`), không ghi key hay nội dung.
- Hạn mức gửi theo gói Resend: xem trang Pricing của Resend.

## Chưa làm

- Email nghiệp vụ khác (hóa đơn, hợp đồng, KYC, tin đăng...): chỉ mới có thông báo hệ thống (bước 1).
- Tùy chọn Email cho các mục khác (vẫn "Sắp có").
- Keycloak vẫn dùng SMTP riêng.

## Bước 1: Email cho thông báo hệ thống

Điều tra (đã kiểm tra trong code):

- **Nguồn phát**: Admin portal gọi `POST /api/v1/notifications/admin/broadcast` tới Core (`NotificationBroadcastController` → `BroadcastNotificationService.enqueueAdmin`). Core ghi bảng outbox `notification_broadcast_outbox`; `BroadcastNotificationPublisher` chia người nhận (USER/ADMIN đang active) theo lô 100 và gửi Kafka `PLATFORM_ANNOUNCEMENT` v1, `sourceEventId=admin_<broadcastId>`, `data={title, body, priority, actionPath}`. Event chỉ có userId, không có email.
- **Fan-out hiện tại**: consumer của notification-service tạo một bản ghi notification cho mỗi người nhận (`NotificationService.create`, idempotent theo `(recipientId, sourceEventId)`), rồi enqueue push (outbox bền trong Mongo) và phát realtime.
- **Tùy chọn người dùng**: nằm ở notification-service (collection `notification_preferences`, `items[{category, push, email}]`, API `GET/PATCH /preferences`). Cờ `email` đã có sẵn nhưng trước đây mặc định `true` và không dùng.
- **Địa chỉ email**: chỉ Core có (bảng `users`). Không đưa email vào Kafka (tránh rò rỉ dữ liệu). Notification-service gọi endpoint nội bộ mới của Core `POST /internal/users/emails` (body `{userIds}` ≤ 100, trả `[{userId, email}]` chỉ cho user active). Endpoint nằm dưới `/internal/**`: Gateway chặn, Core yêu cầu `X-Internal-Secret = GATEWAY_INTERNAL_SECRET`. Không thêm endpoint công khai. Core không lưu cờ "đã xác minh email" nên "đã xác minh" được hiểu là: user active và đã tự bật Email trong cài đặt (phải đăng nhập, mà Keycloak bắt xác minh email trước khi đăng nhập).

Triển khai:

1. Cờ `email` của mục `SYSTEM` mặc định **tắt** (các mục khác giữ nguyên). Dữ liệu cũ có `email=true` chỉ là mặc định cũ, không phải đồng ý, nên khi khởi động có một lần reset `SYSTEM.email=false` cho tài liệu chưa có `emailOptInReset` (cờ đánh dấu, ghi khi lưu/patch về sau).
2. `NotificationService.create` (chỉ với `SYSTEM` + `PLATFORM_ANNOUNCEMENT`), sau khi push/realtime đã xử lý xong, gọi `EmailDeliveryService.enqueue`: nếu key rỗng hoặc user chưa bật Email thì không làm gì, ngược lại ghi một job vào `notification_email_deliveries` (unique theo `notificationId`, nên phát lại không tạo job mới). Lỗi ở bước này bị nuốt, push/realtime không bị ảnh hưởng.
3. Dispatcher chạy nền (5 giây/lần, lease giống push): lấy tối đa 20 job, tra email một lần qua Core, kiểm tra lại tùy chọn, gửi từng email qua `EmailProvider` cách nhau tối thiểu `EMAIL_SEND_INTERVAL_MS = 500` ms (2 request/giây của Resend). `Idempotency-Key = <broadcastId>:<userId>`. Lỗi retry được (429/5xx/timeout/Core không trả lời) thử lại tối đa 5 lần với backoff 1, 2, 4, 8 phút...; lỗi 4xx thất bại ngay. Trạng thái từng người nhận (`sent/skipped/failed`, mã lỗi, id Resend) lưu ở collection trên; log chỉ ghi số lượng, không ghi địa chỉ.

## Layout email dùng chung

Mọi email dùng một layout duy nhất: `src/modules/notification-delivery/email/templates/email-layout.ts` (`renderEmail`). Template viết tay bằng chuỗi TypeScript (không dùng MJML/React Email): bảng HTML, CSS inline, rộng tối đa 600px, mọi khối đặt `bgcolor`/`color` tường minh để chế độ tối không làm mất chữ, nút CTA dạng bảng (bulletproof, Outlook giữ màu nền), logo PNG lấy từ `MAIL_APP_BASE_URL + /logo/homespace-horizontal-logo-removebg.png`, màu chính `#2563eb`/`#163b70`, tông badge: `primary` (thường), `warning` (quan trọng), `danger` (khẩn cấp). Footer cố định: "HomeSpace – Tìm nơi ở lý tưởng", lý do nhận email kèm link `/settings/notifications`, "Đây là email tự động, vui lòng không trả lời.". Bản text thuần sinh từ cùng dữ liệu.

```ts
renderEmail({ baseUrl, category, preheader, heading, badge?, bodyParagraphs, detailRows?, cta?, footerNote? }) // -> { html, text }
```

Thêm email cho module mới: tạo `email/templates/<module>.template.ts` export hàm nhận dữ liệu nghiệp vụ, trả `{ subject, ...renderEmail({...}) }` (xem `system-broadcast.template.ts`); văn bản người dùng được escape sẵn, không tự ghép HTML. Rồi gọi từ một dispatcher/job tương tự `EmailDeliveryService` (kiểm tra tùy chọn, địa chỉ, idempotency key, throttle). Xem thử: `npm run build && npm run mail:preview` ghi `mail-preview/{normal,important,urgent}.html` (đã gitignore) để mở bằng trình duyệt.
