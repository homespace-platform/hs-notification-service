# Kế hoạch email thông báo HomeSpace

Ngày 28/11/2026 · Trạng thái: **chờ chủ dự án duyệt** · Chưa code.

Chi tiết từng module (bảng event, file:dòng, tiêu đề, dòng thông tin, khoá chống trùng, rủi ro) nằm ở `docs/notification-email/`:
[payment](notification-email/payment.md) · [contract](notification-email/contract.md) · [account](notification-email/account.md) · [rental-request](notification-email/rental-request.md) · [appointment](notification-email/appointment.md) · [listing](notification-email/listing.md).
Hạ tầng gửi email, khung mẫu Handlebars và cách thêm mẫu: `docs/EMAIL_RESEND.md`.

## 1. Đã có

- Gửi email qua Resend (`EmailProvider`), outbox + dispatcher nền (2 email/giây, thử lại có giới hạn, chống trùng).
- Khung mẫu chung `templates/layout/base.hbs` + `components/`, mỗi mục một thư mục mẫu.
- Mới gửi email cho **Hệ thống** (thông báo admin), opt-in, mặc định TẮT.

## 2. Tổng hợp (rà lại 28/11 trên code hiện tại)

| Mục (tab app) | Event Core phát | Gửi email | Đính kèm PDF (S3) | Mặc định đề xuất |
|---|---|---|---|---|
| Thanh toán | 34 | 29 | Biên nhận thuê (cả tự xác nhận), biên nhận gói hội viên, biên nhận trả thừa | Chứng từ: LUÔN GỬI · còn lại BẬT |
| Hợp đồng | 49 | 24 (+2 gộp) | Hợp đồng đã ký đủ (kiểm hash/blockchain; lệch thì gửi link) | BẬT |
| Tài khoản | 6 | 5 | — | Khoá/mở khoá: LUÔN GỬI · KYC: BẬT |
| Yêu cầu thuê | 37 (26 thuê + 11 khiếu nại) | 28 (~12 mẫu) | — | TẮT |
| Lịch hẹn | 10 | 7 | `.ics` (giai đoạn 2) | TẮT |
| Tin đăng | 10 | 6 | — | TẮT |
| Hệ thống | 5 | Thông báo admin (đã làm) + sự cố cho admin (gộp theo thành phần) | — | TẮT (thông báo) |
| Tin tức | 1 | Không | — | — |

Không có event nào Core phát mà notification không nhận. Event chết (có mapping, không có producer): `CONTRACT_AWAITING_SIGNATURE/SIGNED/EXPIRED`, `PAYMENT_DISPUTE_*` (7), `PAYMENT_SUCCESSFUL/FAILED/OVERDUE`, `MEMBERSHIP_PAYMENT_REVIEW` (giữ có chủ ý cho Kafka cũ).

### Lỗi phải sửa trước khi bật email
1. Lấy email chỉ trả user đang hoạt động → email "tài khoản bị khoá" không bao giờ gửi được. Cần cho phép riêng `ACCOUNT_DISABLED`.
2. `MEMBERSHIP_OVERPAYMENT_RECEIVED` chỉ mang `orderId` → tra nhầm biên nhận mua gói. Thêm `overpaymentId`.
3. Job xử lý đơn REVIEW cũ lúc khởi động sẽ phát loạt email chuyện cũ → không gửi email cho event phát từ job này.
4. Sự cố BLOCKCHAIN tạo 1 incident mỗi tài liệu → gộp theo thành phần trước khi gửi email admin.
5. `RENTAL_HOLD_EXTENDED` dùng cho 2 nghĩa → tách event "sắp hết hạn trả tháng đầu".
6. `INVOICE_AMOUNT_UPDATED` (phạt tăng mỗi ngày) → không gửi email.
7. PDF biên nhận tạo sau event → email đợi PDF sẵn (hoặc event "PDF sẵn sàng"); worker PDF dừng im lặng sau 5 lần lỗi.

## 3. Quyết định cần chủ dự án chốt

1. **Mặc định BẬT/TẮT** theo bảng trên. Lưu ý: code hiện đặt sẵn `email=true` cho nhiều mục (`notification.service.ts:221`); đó là giá trị mặc định cũ, không phải người dùng đồng ý. Đề xuất: đặt lại theo bảng, giữ lựa chọn người dùng đã tự đổi sau này.
2. **Email bảo mật không tắt được** (khoá/mở khoá tài khoản, đổi vai trò; sau này đổi mật khẩu, đổi tài khoản ngân hàng).
3. **PDF (chủ dự án chốt 28/11): đính kèm file thật lấy từ S3** cho email hoá đơn/biên nhận và hợp đồng. Cách lấy: notification gọi API nội bộ của Core (`/internal/**`, có `GATEWAY_INTERNAL_SECRET`), Core đọc S3 và kiểm tra toàn vẹn như endpoint tải PDF hiện có rồi trả byte; notification không giữ khoá S3. Giới hạn: tổng đính kèm Resend 40 MB; file quá lớn hoặc chưa sẵn sàng thì gửi email kèm link và ghi lý do. Hoá đơn tháng và gói hội viên chưa có PDF trên S3 → phải sinh PDF trước (Gotenberg) mới đính kèm được. Lưu ý: PDF hợp đồng có thể chứa CCCD/địa chỉ/số tài khoản; chỉ gửi tới email của chính các bên trong hợp đồng.
4. **Hạn mức Resend:** gói miễn phí ~100 email/ngày. Bật mặc định 3 mục Thanh toán / Hợp đồng / Bảo mật sẽ cần nâng gói khi người dùng tăng.

## 4. Việc nền tảng (làm trước, dùng chung mọi module)

| # | Việc | Repo |
|---|---|---|
| N1 | Bỏ gắn cứng SYSTEM: bảng **chính sách email theo eventType** (gửi / không / gộp, mẫu nào, bỏ qua opt-in hay không) | notification |
| N2 | Mặc định email theo từng mục + bước chuyển đổi một lần cho các giá trị `email=true` cũ | notification |
| N3 | `EmailProvider` hỗ trợ **đính kèm** (Resend `attachments`, base64, tối đa 40 MB) | notification |
| N4 | API nội bộ ở Core trả **dữ liệu cho email** (số tiền, kỳ, mã, hạn chót, địa chỉ khi được phép) vì event chỉ mang ID; và API nội bộ trả **byte PDF từ S3** (biên nhận, hợp đồng, phụ lục, hợp đồng cọc) có kiểm tra quyền + toàn vẹn | core |
| N5 | API lấy email phải trả cả **tài khoản vừa bị khoá** cho email bảo mật | core |
| N6 | Web + mobile: mở công tắc Email theo từng mục đã làm, giữ "Sắp có" cho mục chưa làm; mục bảo mật hiển thị "luôn gửi" | web, mobile |

## 5. Lộ trình (làm lần lượt, mỗi bước xong → test → push → thử trên server)

| Bước | Nội dung | Phụ thuộc |
|---|---|---|
| 0 | N1, N2, N6 | — |
| 1 | **Thanh toán & Hóa đơn**: email cho các event hiện có; "thanh toán thành công" kèm **biên nhận PDF** khi PDF đã sẵn (chờ worker, hoặc gửi khi PDF xong) | N3, N4 |
| 2 | **Hợp đồng & Đặt cọc**: 14 email, **đính kèm PDF hợp đồng/phụ lục đã ký từ S3**; bản tổng hợp Chi nhánh | N3, N4 |
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

## 8. Triển khai đợt 1 (chủ dự án chốt 28/11): Thanh toán + Hợp đồng

Mặc định: Thanh toán = chứng từ **LUÔN GỬI**, còn lại BẬT (tắt được); Hợp đồng = BẬT (tắt được). Các mục khác giữ "Sắp có".

### Đính kèm
| Email | File |
|---|---|
| Thanh toán thành công / tự xác nhận (`PAYMENT_RECEIPT_CONFIRMED`, `PAYMENT_RECEIPT_AUTO_CONFIRMED`) | Biên nhận thuê `RENTAL_RECEIPT` |
| Kích hoạt gói (`MEMBERSHIP_ACTIVATED`) | `MEMBERSHIP_RECEIPT` |
| Trả thừa (`MEMBERSHIP_OVERPAYMENT_RECEIVED`) | `OVERPAYMENT_RECEIPT` (event phải mang `overpaymentId`) |
| HĐ cọc ký xong | **Không đính kèm** |
| **HĐ thuê ký xong** | `LEASE_BUNDLE`: **PDF HĐ thuê + PDF HĐ cọc** (nếu có cọc) trong **cùng một email** |

### API nội bộ Core (chỉ notification gọi, `/internal/**` + `X-Internal-Secret`, tìm Core qua Eureka)
`GET /internal/documents/{kind}/{id}?recipientId=<userId>` với `kind` ∈ `rental-receipts`, `membership-receipts` (id = orderId), `overpayment-receipts` (id = overpaymentId), `lease-bundles` (id = lease contractId).
- 200 `{ files: [{ fileName, contentType: "application/pdf", contentBase64, sizeBytes }] }`
- 409 `NOT_READY` (PDF chưa tạo xong → notification thử lại), 404 không có, 403 `recipientId` không phải bên liên quan, 422 file lệch hash/blockchain (→ gửi email không đính kèm, kèm link).
- Core kiểm tra người nhận là chủ biên nhận / một bên hợp đồng; HĐ dùng đúng kiểm tra toàn vẹn của endpoint tải PDF hiện có (biến thể hệ thống, không cần user đăng nhập).

### Notification
- `email-spec.ts` là hợp đồng chung; mỗi mục `templates/<category>/index.ts` export `Record<eventType, EmailSpec>`; mẫu `.hbs` trong cùng thư mục, dùng `layout/base.hbs`.
- Dispatcher chung (bỏ gắn cứng SYSTEM): event có spec → xếp email; `ALWAYS` bỏ qua công tắc; `OPT_IN` theo công tắc mục; tổng file > 35 MB hoặc 422 → gửi không đính kèm + link; 409 → thử lại có giới hạn rồi gửi kèm link.
- Không gửi email cho: event phát từ job xử lý đơn REVIEW cũ, `INVOICE_AMOUNT_UPDATED`.
