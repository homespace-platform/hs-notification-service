# Gửi email qua Resend

Giai đoạn 1: service đã có nền tảng gửi email (`EmailProvider.sendEmail` trong `notification-delivery`). Chưa có email nghiệp vụ nào.

## Biến môi trường

| Biến | Ý nghĩa |
| --- | --- |
| `MAIL_RESEND_API_KEY` | API key Resend (bí mật). Để trống thì kênh email bị tắt, service vẫn khởi động và ghi một dòng log cảnh báo. |
| `MAIL_FROM_ADDRESS` | Địa chỉ gửi, phải thuộc domain đã verify. Bắt buộc khi có API key. |
| `MAIL_FROM_NAME` | Tên hiển thị, gửi dưới dạng `Tên <địa chỉ>`. Bắt buộc khi có API key. |
| `MAIL_APP_BASE_URL` | Origin công khai của web (vd `https://homespace.id.vn`, không có `/` cuối): dùng cho logo, nút CTA và link cài đặt trong email. Bắt buộc khi có API key. |

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
- **Địa chỉ email**: chỉ Core có (bảng `users`). Không đưa email vào Kafka (tránh rò rỉ dữ liệu). Notification-service tìm Core qua Eureka (app `HS-CORE-API`, cache 30 giây, không cần biến môi trường riêng) rồi gọi endpoint nội bộ mới `POST /internal/users/emails` (body `{userIds}` ≤ 100, trả `[{userId, email}]` chỉ cho user active). Endpoint nằm dưới `/internal/**`: Gateway chặn, Core yêu cầu `X-Internal-Secret = GATEWAY_INTERNAL_SECRET`. Không thêm endpoint công khai. Core không lưu cờ "đã xác minh email" nên "đã xác minh" được hiểu là: user active và đã tự bật Email trong cài đặt (phải đăng nhập, mà Keycloak bắt xác minh email trước khi đăng nhập).

Triển khai:

1. Cờ `email` của mục `SYSTEM` mặc định **tắt** (các mục khác giữ nguyên). Dữ liệu cũ có `email=true` chỉ là mặc định cũ, không phải đồng ý, nên khi khởi động có một lần reset `SYSTEM.email=false` cho tài liệu chưa có `emailOptInReset` (cờ đánh dấu, ghi khi lưu/patch về sau).
2. `NotificationService.create` (chỉ với `SYSTEM` + `PLATFORM_ANNOUNCEMENT`), sau khi push/realtime đã xử lý xong, gọi `EmailDeliveryService.enqueue`: nếu key rỗng hoặc user chưa bật Email thì không làm gì, ngược lại ghi một job vào `notification_email_deliveries` (unique theo `notificationId`, nên phát lại không tạo job mới). Lỗi ở bước này bị nuốt, push/realtime không bị ảnh hưởng.
3. Dispatcher chạy nền (5 giây/lần, lease giống push): lấy tối đa 20 job, tra email một lần qua Core, kiểm tra lại tùy chọn, gửi từng email qua `EmailProvider` cách nhau tối thiểu `EMAIL_SEND_INTERVAL_MS = 500` ms (2 request/giây của Resend). `Idempotency-Key = <broadcastId>:<userId>`. Lỗi retry được (429/5xx/timeout/Core không trả lời) thử lại tối đa 5 lần với backoff 1, 2, 4, 8 phút...; lỗi 4xx thất bại ngay. Trạng thái từng người nhận (`sent/skipped/failed`, mã lỗi, id Resend) lưu ở collection trên; log chỉ ghi số lượng, không ghi địa chỉ.

## Layout email dùng chung

Mọi email dùng một layout duy nhất. Template là file Handlebars `.hbs` (dependency `handlebars` ghim đúng phiên bản 4.7.10), nằm ở `src/modules/notification-delivery/email/templates/`:

```
layout/base.hbs        khung chung: logo (MAIL_APP_BASE_URL + /logo/homespace-horizontal-logo-removebg.png), ô nội dung, footer
components/*.hbs       partial tự đăng ký: badge, heading, paragraph, details, detail-row, button, footer-note, footer
system/broadcast.hbs   email "Thông báo hệ thống" + system/index.ts (tiêu đề email, hàm render)
account/ listing/ appointment/ contract/ payment/ chat/ rental-request/ news/   chỉ có README.md (đúng 9 mục trong Cài đặt → Thông báo)
```

Quy ước: bảng HTML, CSS inline, rộng tối đa 600px, mọi khối đặt màu tường minh để chế độ tối không làm mất chữ, nút CTA dạng bảng (Outlook giữ màu nền), màu chính `#2563eb`/`#163b70`, badge `primary` (thường) / `warning` (quan trọng) / `danger` (khẩn cấp). Handlebars chạy `strict: true` (thiếu biến thì lỗi), `{{x}}` luôn escape, chỉ ô `{{{content}}}` của layout là raw. Mỗi template được compile một lần khi khởi động (`template-engine.ts`); thiếu thư mục/file thì service không khởi động và báo rõ. File `.hbs` được copy vào `dist` qua `assets` trong `nest-cli.json`. Bản text thuần sinh từ cùng dữ liệu.

```ts
renderEmail({ template, baseUrl, category, preheader, heading, badge?, bodyParagraphs, detailRows?, cta?, footerNote? }) // -> { html, text }
```

### Thêm email cho module mới

1. Tạo `templates/<category>/<ten>.hbs` (copy `system/broadcast.hbs`, dùng các partial `{{> components/...}}`; có thể sửa thứ tự/bổ sung khối). Xóa dòng liệt kê trong README của thư mục đó.
2. Tạo `templates/<category>/index.ts` export hàm `render...Email(data)` gọi `renderEmail({ template: '<category>/<ten>', category: '<tên mục>', ... })` và hàm tiêu đề email (xem `system/index.ts`).
3. Thêm test (escape, tiêu đề, link) cạnh `email/email.spec.ts`.
4. Viết dispatcher/job kiểu `EmailDeliveryService`: kiểm tra tùy chọn Email của mục, địa chỉ qua `UserEmailDirectory`, `Idempotency-Key`, throttle.
5. Xem thử: `npm run build && npm run mail:preview` ghi `mail-preview/{normal,important,urgent}.html` (đã gitignore), mở bằng trình duyệt.
