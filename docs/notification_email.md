# Kế hoạch email thông báo HomeSpace

Ngày 28/11/2026 · Trạng thái: **chờ chủ dự án duyệt** · Chưa code.

Chi tiết từng module (bảng event, file:dòng, tiêu đề, dòng thông tin, khoá chống trùng, rủi ro) nằm ở `docs/notification-email/`:
[payment](notification-email/payment.md) · [contract](notification-email/contract.md) · [account](notification-email/account.md) · [rental-request](notification-email/rental-request.md) · [appointment](notification-email/appointment.md) · [listing](notification-email/listing.md).
Hạ tầng gửi email, khung mẫu Handlebars và cách thêm mẫu: `docs/EMAIL_RESEND.md`.

## 1. Đã có

- Gửi email qua Resend (`EmailProvider`), outbox + dispatcher nền (2 email/giây, thử lại có giới hạn, chống trùng).
- Khung mẫu chung `templates/layout/base.hbs` + `components/`, mỗi mục một thư mục mẫu.
- Mới gửi email cho **Hệ thống** (thông báo admin), opt-in, mặc định TẮT.

## 2. Tổng hợp 6 module

| Mục | Số event | Gửi email | Đề xuất mặc định | Điểm chính |
|---|---|---|---|---|
| Thanh toán & Hóa đơn | ~35 | Phần lớn | **BẬT** | "Thanh toán thành công" = `PAYMENT_RECEIPT_CONFIRMED`; biên nhận PDF do worker nền tạo **sau** khi xác nhận; hoá đơn tháng và gói hội viên **chưa có PDF** |
| Hợp đồng & Đặt cọc | ~50 | 14 | **BẬT** | Đã ký đủ, tới lượt ký, phụ lục, gia hạn, chấm dứt, quyết toán, kết quả khiếu nại; PDF hợp đồng gửi **link đăng nhập**, không đính kèm |
| Tài khoản & Bảo mật | 6 có email | 6 | KYC: **BẬT**; khoá/mở khoá/đổi vai trò: **luôn gửi** | Không bao giờ đưa CCCD, dữ liệu KYC, số tài khoản vào email |
| Yêu cầu thuê | 26 | ~17 (+3 gộp) | TẮT | Thiếu nhắc "sắp hết hạn phản hồi / giữ chỗ"; event chưa mang hạn chót |
| Lịch hẹn xem nhà | 10 | 7 | TẮT | Nhắc lịch đã có (cửa sổ 24 giờ); `.ics` để giai đoạn 2; địa chỉ chỉ trong email đã xác nhận |
| Tin đăng cho thuê | — | 6 | TẮT | Duyệt, từ chối, sửa bị từ chối, hết hạn, bị ẩn, vi phạm; thiếu nhắc "tin sắp hết hạn" |
| Tin tức, Tin nhắn | — | Không | — | Có thể làm email tổng hợp tuần / tin chưa đọc 24 giờ sau |

Thêm: **bản tổng hợp Chi nhánh 08:00** gửi email cho chủ nhà, mặc định TẮT.

## 3. Quyết định cần chủ dự án chốt

1. **Mặc định BẬT/TẮT** theo bảng trên. Lưu ý: code hiện đặt sẵn `email=true` cho nhiều mục (`notification.service.ts:221`); đó là giá trị mặc định cũ, không phải người dùng đồng ý. Đề xuất: đặt lại theo bảng, giữ lựa chọn người dùng đã tự đổi sau này.
2. **Email bảo mật không tắt được** (khoá/mở khoá tài khoản, đổi vai trò; sau này đổi mật khẩu, đổi tài khoản ngân hàng).
3. **PDF:** biên nhận thanh toán **đính kèm** (do HomeSpace tạo, ít dữ liệu nhạy cảm, cần xác minh mẫu không chứa số tài khoản đầy đủ); hợp đồng **chỉ gửi link** cần đăng nhập (chứa CCCD, địa chỉ, ngân hàng).
4. **Hạn mức Resend:** gói miễn phí ~100 email/ngày. Bật mặc định 3 mục Thanh toán / Hợp đồng / Bảo mật sẽ cần nâng gói khi người dùng tăng.

## 4. Việc nền tảng (làm trước, dùng chung mọi module)

| # | Việc | Repo |
|---|---|---|
| N1 | Bỏ gắn cứng SYSTEM: bảng **chính sách email theo eventType** (gửi / không / gộp, mẫu nào, bỏ qua opt-in hay không) | notification |
| N2 | Mặc định email theo từng mục + bước chuyển đổi một lần cho các giá trị `email=true` cũ | notification |
| N3 | `EmailProvider` hỗ trợ **đính kèm** (Resend `attachments`, giới hạn kích thước) | notification |
| N4 | API nội bộ ở Core trả **dữ liệu cho email** (số tiền, kỳ, mã, hạn chót, địa chỉ khi được phép) vì event chỉ mang ID; và lấy **PDF biên nhận dạng byte** | core |
| N5 | API lấy email phải trả cả **tài khoản vừa bị khoá** cho email bảo mật | core |
| N6 | Web + mobile: mở công tắc Email theo từng mục đã làm, giữ "Sắp có" cho mục chưa làm; mục bảo mật hiển thị "luôn gửi" | web, mobile |

## 5. Lộ trình (làm lần lượt, mỗi bước xong → test → push → thử trên server)

| Bước | Nội dung | Phụ thuộc |
|---|---|---|
| 0 | N1, N2, N6 | — |
| 1 | **Thanh toán & Hóa đơn**: email cho các event hiện có; "thanh toán thành công" kèm **biên nhận PDF** khi PDF đã sẵn (chờ worker, hoặc gửi khi PDF xong) | N3, N4 |
| 2 | **Hợp đồng & Đặt cọc**: 14 email, link PDF; bản tổng hợp Chi nhánh | N4 |
| 3 | **Tài khoản & Bảo mật**: KYC + khoá/mở khoá/vai trò | N5 |
| 4 | **Yêu cầu thuê**: email + thêm hạn chót vào event | N4 |
| 5 | **Lịch hẹn** (chống gửi trùng xác nhận + nhắc lịch) và **Tin đăng** | N4 |
| 6 | Bổ sung thông báo còn thiếu (mục 6) | từng module |
| 7 | Giai đoạn 2: `.ics`, PDF hoá đơn tháng / gói hội viên, email tổng hợp tin tức, cảnh báo đăng nhập lạ | — |

## 6. Thông báo còn thiếu (chưa có cả thông báo trong app)

- **Thanh toán:** PDF biên nhận tạo lỗi im lặng; chủ nhà (bên nhận) không có bản biên nhận; đơn gói hội viên hết hạn thanh toán/huỷ không báo.
- **Hợp đồng:** không cảnh báo 24 giờ trước khi hệ thống tự xử lý mặc định (bên chậm chịu thiệt); không nhắc hạn phản hồi phụ lục, gia hạn, quyết toán; không nhắc 30 và 7 ngày trước khi hết hợp đồng.
- **Tài khoản:** đổi tài khoản ngân hàng (ưu tiên cao), đổi mật khẩu, đổi email/SĐT; đăng nhập thiết bị lạ (khó, để sau).
- **Yêu cầu thuê:** sắp hết hạn phản hồi, sắp hết giữ chỗ, sắp hết cửa sổ trả tiền thuê kỳ đầu.
- **Tin đăng:** tin sắp hết hạn hiển thị.

## 7. Cần kiểm tra lại khi làm

- Event không có nơi phát trong Core: `CONTRACT_*` cũ, `PAYMENT_DISPUTE_*`, `PAYMENT_SUCCESSFUL/FAILED/OVERDUE` (có mẫu trong notification nhưng có thể là code chết).
- Mẫu biên nhận PDF có chứa thông tin ngân hàng đầy đủ không; kích thước PDF.
- Đường dẫn nút bấm phía người thuê nằm trong **hs-web-app** (không có hs-client-portal).
- Người nhận của các cảnh báo "sắp tự xác nhận" khoản chuyển.
