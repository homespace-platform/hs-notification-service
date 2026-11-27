# Gửi email qua Resend

Giai đoạn 1: service đã có nền tảng gửi email (`EmailProvider.sendEmail` trong `notification-delivery`). Chưa có email nghiệp vụ nào.

## Biến môi trường

| Biến | Ý nghĩa |
| --- | --- |
| `MAIL_RESEND_API_KEY` | API key Resend (bí mật). Để trống thì kênh email bị tắt, service vẫn khởi động và ghi một dòng log cảnh báo. |
| `MAIL_FROM_ADDRESS` | Địa chỉ gửi, phải thuộc domain đã verify. Bắt buộc khi có API key. |
| `MAIL_FROM_NAME` | Tên hiển thị, gửi dưới dạng `Tên <địa chỉ>`. Bắt buộc khi có API key. |

`compose.production.yml` truyền cả ba biến; đặt chúng trong Dokploy.

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

- Chưa có email nghiệp vụ (hóa đơn, hợp đồng...).
- Chưa có tùy chọn nhận email của người dùng.
- Keycloak vẫn dùng SMTP riêng.
