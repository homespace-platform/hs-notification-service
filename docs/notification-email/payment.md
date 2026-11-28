# Email module "Thanh toán & Hóa đơn" - kiểm tra lại 28/11/2026 (chỉ audit, chưa code)

CORE = hs-core-api, NS = hs-notification-service. `file:line` là bằng chứng; "(giả định)" = chưa kiểm chứng. PRS = `hs-payment-service/.../service/PaymentRequestService.java`, MBS/CLS = `hs-contract-service/.../service/MonthlyBillingService|ContractLifecycleService.java`, MPA = `hs-payment-service/.../membership/MembershipPaymentApplier.java`, NE = NS `notification-events/notification-event.ts`.
Nền tảng đã kiểm: event chỉ mang ID (`{paymentId}` / `{contractId,invoiceId}` / `{orderId}` / `{}`); NS email vẫn chỉ SYSTEM, chưa có attachments (`email.provider.ts:8-15`, `email-outbox.ts:173-176`); CORE chỉ có `/internal/users` (`UserInternalController.java:21`), chưa có endpoint nội bộ nào lấy số tiền, hạn hay PDF.

## 1. Bảng đầy đủ (Core đang phát: 34 eventType; mọi event đều có mapping trong NE, 0 event bị DLT)
Danh mục app: PAYMENT = Thanh toán; SETTLEMENT_* nằm ở **Hợp đồng** (NE:925-931), không phải Thanh toán.

| eventType | Khi nào phát | Người nhận | Tiêu đề hiện tại (NE) | Email? | Lý do |
|---|---|---|---|---|---|
| PAYMENT_REQUEST_CREATED | PRS:248 (tiền tháng đầu trễ), :278 (quyết toán/hoàn cọc), :310 (chênh lệch cọc), :977 (hoàn tiền hủy trước thuê) | payer | Có khoản thanh toán mới | Có | Có việc phải trả; cọc/tháng đầu lúc chấp nhận được báo bằng RENTAL_REQUEST_ACCEPTED (module rental-request) |
| PAYMENT_DUE_SOON | PaymentDueReminderScheduler:47 (không gồm MONTHLY_RENT, :43) | payer | Sắp đến hạn thanh toán | Có | Nhắc hạn, 1 lần/hạn (`reminderForDueAt` :46) |
| PAYMENT_OBLIGATION_OVERDUE | PRS:323 (chỉ DEPOSIT_ADJUSTMENT, INITIAL_PAYMENT_REFUND) | payer | Nghĩa vụ thanh toán cần được kiểm tra | Có | Quá hạn, 1 lần (:320) |
| PAYMENT_TRANSFER_REPORTED | PRS:559, PaymentProofUploadSessionService:387 | payee | Có khoản chuyển tiền cần xác nhận | Có | Bên nhận phải xử lý, nếu không bị tự xác nhận |
| PAYMENT_RECEIPT_CONFIRMED | PRS:726 (cuối confirmLocked, sau capture :719) | payer | Khoản thanh toán đã được xác nhận nhận tiền | **Có + PDF** | "Thanh toán thành công" + biên nhận |
| PAYMENT_RECEIPT_REJECTED | PRS:769 | payer | Bên nhận từ chối xác nhận khoản chuyển | Có | Phải xử lý lại |
| PAYMENT_RECEIPT_AUTO_CONFIRM_SOON | PRS:674 (once) | payee | Sắp tự động xác nhận đã nhận tiền | Có | Bên chậm chịu hậu quả |
| PAYMENT_REFUND_AUTO_CONFIRM_SOON | PRS:627 (once) | payee (người thuê) | Sắp tự động xác nhận hoàn tiền | Có | Như trên |
| PAYMENT_RECEIPT_AUTO_CONFIRMED | PRS:608 (hoàn tiền), :663 | payee | Hệ thống đã xác nhận thay bạn | Có (+PDF, đề xuất) | Hệ thống tự quyết; payee không có email biên nhận nào khác |
| INVOICE_METER_REMINDER | MBS:1220 | chủ nhà | Cần chốt chỉ số hóa đơn | Không | Việc nội bộ, in-app đủ |
| INVOICE_DRAFT_READY | MBS:1032 | chủ nhà | Có hóa đơn tháng mới cần kiểm tra | Không | Nhắc nội bộ hàng tháng |
| INVOICE_ISSUED | MBS:999 (tổng=0 thì im lặng), CLS:326 (hóa đơn bổ sung kỳ cuối) | người thuê | Hóa đơn tháng đã được phát hành | Có (không PDF) | Cần số tiền/hạn; chưa có PDF hóa đơn |
| INVOICE_PAYMENT_REMINDER | MBS:1240 (1 lần, T-2 ngày) | người thuê | Hóa đơn sắp đến hạn | Có | Nhắc hạn |
| INVOICE_OVERDUE | MBS:1124 (chủ nhà), :1125 (cả hai) | chủ nhà / cả hai | Hóa đơn tháng đã quá hạn | Có | Quá hạn; **nếu hôm đó người thuê đã nhận EXTENSION_EXPIRED thì chỉ chủ nhà nhận** (:1123-1124) |
| INVOICE_AMOUNT_UPDATED | MBS:1128 (chỉ khi phí phạt tăng và tenant chưa được báo cùng lần) | người thuê | Số tiền hóa đơn đã được cập nhật | Không | Phí phạt FIXED_PER_DAY tăng mỗi ngày (:1283-1289) => email hằng ngày; gộp ý vào email INVOICE_OVERDUE |
| INVOICE_EXTENSION_REQUESTED | MBS:91 | chủ nhà | Có yêu cầu gia hạn thanh toán hóa đơn | Có | Cần phản hồi |
| INVOICE_EXTENSION_APPROVED / _REJECTED | MBS:161 / :110 | người thuê | Hóa đơn tháng được gia hạn / Yêu cầu bị từ chối | Có | Đổi hạn trả |
| INVOICE_EXTENSION_EXPIRED | MBS:1090 | người thuê | Yêu cầu gia hạn thanh toán đã hết hạn | **Có** (sửa: không Gộp) | Là thông báo quá hạn duy nhất của người thuê trong lần đó (:1086-1091, :1124) |
| INVOICE_OVERDUE_ACTION_REQUIRED | MBS:1255 | chủ nhà | Hóa đơn quá hạn cần chủ nhà xử lý | Có | Có hạn xử lý |
| INVOICE_OVERDUE_ACTION_RECORDED | MBS:490 | người thuê | Chủ nhà đã ghi nhận một bước xử lý | Có | Ảnh hưởng thuê |
| INVOICE_OVERDUE_ACTION_ACKNOWLEDGED | MBS:517 | chủ nhà | Đã ghi nhận phản hồi của người thuê | Không | Thông tin phụ |
| INVOICE_DEFERRED | MBS:554, :1158-1159 | người thuê / cả hai | Có quyết định chuyển khoản nợ sang hóa đơn sau | Có | Đổi nghĩa vụ |
| INVOICE_ROLLED_OVER | MBS:986 | người thuê | Khoản chưa thanh toán đã chuyển sang hóa đơn khác | Có | QR/yêu cầu cũ bị hủy |
| SETTLEMENT_RESPONSE_NEEDED | CLS:201 | người thuê | Có đề xuất hoàn cọc cần phản hồi | Có | Cần phản hồi trong hạn |
| SETTLEMENT_AGREED | CLS:260 (chỉ nhánh người thuê phải trả thêm) | chủ nhà | Đề xuất hoàn cọc đã được đồng ý | Có | Chủ nhà chờ tiền |
| SETTLEMENT_DISPUTED | CLS:278 | chủ nhà | Cần đối soát đề xuất hoàn cọc | Có | Cần xử lý |
| SETTLEMENT_PROPOSAL_INVALIDATED | CLS:334 | người thuê | Đề xuất hoàn cọc cần được lập lại | Không | In-app đủ, sẽ có RESPONSE_NEEDED khi lập lại |
| SETTLEMENT_RESPONSE_OVERDUE | CLS:455 | người thuê hoặc chủ nhà | Phản hồi đề xuất hoàn cọc cần được kiểm tra | Có | Quá hạn |
| SETTLEMENT_PAYMENT_OVERDUE | CLS:466 | payer | Khoản hoàn cọc/quyết toán cần được kiểm tra | Có | Quá hạn tiền cọc |
| MEMBERSHIP_ACTIVATED | MPA:67-68 (SePay `MembershipCheckoutService:233`, ETH `EthPaymentService:174`; gói, nâng cấp, addon, trả muộn) | chủ tài khoản | Gói đăng tin đã được kích hoạt | **Có + PDF** | Biên nhận mua gói |
| MEMBERSHIP_OVERPAYMENT_RECEIVED | MPA:81-82 (giao dịch thứ 2 / không áp dụng được / đơn FAILED :60) | chủ tài khoản | Đã nhận khoản trả thừa | **Có + PDF** | Tiền sẽ hoàn lại, cần chứng từ |
| MEMBERSHIP_EXPIRING_SOON / _EXPIRED | `AccountNotificationWriter:81-84` (lịch `MembershipExpiryReminderScheduler:48-49`, dedupe theo ngày hết hạn) | chủ tài khoản | Gói thành viên sắp hết hạn / đã hết hạn | Có | Mất quyền đăng tin; danh mục PAYMENT (NE:801-803) |
| **Chết (consumer có, Core KHÔNG phát)** | PAYMENT_DISPUTE_* x7 (NE:290-314; tính năng đối soát thanh toán đã gỡ), PAYMENT_SUCCESSFUL/FAILED/OVERDUE (NE:189-206), MEMBERSHIP_PAYMENT_REVIEW (NE:214, cố ý giữ cho Kafka cũ) | - | - | Không | 11 mapping chết: xóa 10, giữ 1 legacy tới khi Kafka sạch. Chưa có event Core phát mà NS không map |

Tổng: 34 event, Có = 29 (4 kèm PDF + 1 đề xuất), Không = 5 (METER_REMINDER, DRAFT_READY, AMOUNT_UPDATED, ACTION_ACKNOWLEDGED, PROPOSAL_INVALIDATED).

## 2. Email "Có": nội dung, đính kèm, cờ, khóa chống trùng
Nút luôn là `MAIL_APP_BASE_URL` + actionPath có sẵn: payment `/dashboard/payments?paymentId=` (NE:875); hóa đơn `/dashboard/invoices/{contractId}?section=monthly&invoice={id}` (NE:887); hoàn cọc `.../invoices/{contractId}?section=deposit` (NE:11); gói `/dashboard/membership/return?orderId=` (NE:967-968); trả thừa `/dashboard/invoices?tab=membership` (NE:965-966); hết hạn `/dashboard/membership` (NE:803). Không đưa số tài khoản đầy đủ, tên chủ TK, ghi chú tự do, link S3.
Cờ (đề xuất, cần chủ dự án chốt): chứng từ tiền (RECEIPT_CONFIRMED, ACTIVATED, OVERPAYMENT) = LUÔN GỬI; các email PAYMENT còn lại = BẬT theo công tắc Thanh toán; SETTLEMENT_* theo công tắc Hợp đồng; MEMBERSHIP_EXPIRING/EXPIRED = BẬT.
Khóa chống trùng chung: job theo `notificationId` + Resend Idempotency-Key `sourceEventId:recipientId`; thêm khóa nghiệp vụ cho chứng từ: `payment-receipt:{paymentId}`, `membership-receipt:{receiptId}`.

| Email | Subject | Dòng thông tin | Đính kèm PDF (ai tạo, có trên S3 chưa) |
|---|---|---|---|
| RECEIPT_CONFIRMED (và AUTO_CONFIRMED) | `Biên nhận thanh toán {receiptNumber}` | số biên nhận, loại khoản, số tiền, thời điểm xác nhận, mã hợp đồng/địa chỉ phòng | **Biên nhận thanh toán** `payment_receipts`, Core tạo: worker 15s (`PaymentReceiptPdfWorker:38`) render Gotenberg, lưu S3 PRIVATE purpose PAYMENT_RECEIPT. Có sẵn trên S3 nhưng **chưa sẵn lúc event tới** (capture không render, `PaymentReceiptService:41-49`). Chỉ khi tổng > 0. Chưa có endpoint nội bộ lấy bytes (`pdf()` :274 kiểm quyền theo actor) |
| MEMBERSHIP_ACTIVATED | `Đã kích hoạt gói {tên gói}` / `Mua thêm {n} lượt đăng tin` / `Nâng cấp lên {gói}` | tên gói, số tiền, thời điểm, mã GD che 4 số cuối | **Biên nhận gói** `membership_receipts` (`HS-MB-yyyyMMdd-...`, `MembershipReceiptService:35-83`): Gotenberg + S3, cùng kiểu bất đồng bộ (`MembershipReceiptPdfWorker`). Có sẵn nhưng chưa sẵn lúc event tới |
| MEMBERSHIP_OVERPAYMENT_RECEIVED | `Đã nhận khoản trả thừa {số tiền}` | số tiền, nhà cung cấp, mã GD che, "sẽ được hoàn lại" | **Biên nhận trả thừa** (cũng là `membership_receipts`, kind OVERPAYMENT, `MembershipReceiptService:87-112`). **Cảnh báo tra cứu**: biên nhận khóa theo `overpayment.id` (:91) còn event mang `orderId` gốc (`MembershipNotificationWriter:56`) => tra theo `orderId` sẽ trả nhầm biên nhận mua gói. Cần thêm `overpaymentId` vào data |
| INVOICE_ISSUED | `Hóa đơn tháng {MM/YYYY} - {địa chỉ}` | kỳ, tổng, hạn, tiền điện/nước tổng | **Không có PDF**: PDF hóa đơn tháng chưa tồn tại (chỉ có PDF hợp đồng). v1 gửi bảng tóm tắt trong thân mail + nút; muốn đính kèm phải làm bước sinh PDF hóa đơn trước |
| REQUEST_CREATED, DUE_SOON, INVOICE_PAYMENT_REMINDER | `Bạn có khoản cần thanh toán {amount}` / `Sắp đến hạn {amount}` | loại, số tiền, hạn | Không |
| OBLIGATION_OVERDUE, INVOICE_OVERDUE, EXTENSION_EXPIRED, SETTLEMENT_PAYMENT_OVERDUE | `Khoản thanh toán đã quá hạn` | số tiền, hạn, "phí phạt có thể tăng mỗi ngày, mở hóa đơn xem số hiện tại" | Không |
| TRANSFER_REPORTED, RECEIPT_REJECTED, AUTO_CONFIRM_SOON x2 | `Cần xác nhận khoản chuyển {amount}` / `Khoản chuyển bị từ chối` | số tiền, mã tham chiếu CK, hạn xử lý | Không |
| EXTENSION_*, ACTION_*, DEFERRED, ROLLED_OVER, SETTLEMENT_* (5 loại Có), MEMBERSHIP_EXPIRING/EXPIRED | theo title in-app + kỳ/phòng | hạn phản hồi, tổng tiền đề xuất / ngày hết hạn gói | Không |

Email phải đọc **trạng thái hiện tại** lúc gửi và bỏ qua nếu hết ý nghĩa (nhắc hạn nhưng đã CONFIRMED). Số tiền/hạn/ngày hết hạn không có trong event => cần endpoint nội bộ mới (mục 4).

## 3. Thiếu thông báo / lỗ hổng
1. **PDF sẵn sàng / thất bại không có tín hiệu**: cả hai worker chỉ set READY/FAILED, không phát event (`PaymentReceiptPdfWorker:116-123`, `MembershipReceiptPdfWorker:116-117`); tối đa 5 lần, nghỉ 30s x lần (~7,5 phút) rồi im lặng, chỉ người dùng bấm retry trong web mới chạy lại. Email biên nhận phải poll trạng thái; hết cửa sổ vẫn gửi (không đính kèm, nói rõ tải trong Lịch sử thanh toán) và log cảnh báo ops.
2. **Hoàn tiền trả thừa không có kết thúc**: `MembershipOverpayment.Status.REFUNDED` (`MembershipOverpayment.java:37`) không được set ở đâu trong code Core, không thấy endpoint admin "Hoàn tiền/Đã hoàn" như chủ dự án mô tả => không có event "đã hoàn". Cần endpoint + event MEMBERSHIP_OVERPAYMENT_REFUNDED (Có).
3. **Bên được nhận tiền không biết quá hạn**: PAYMENT_OBLIGATION_OVERDUE / SETTLEMENT_PAYMENT_OVERDUE chỉ gửi payer (PRS:323, CLS:466); người thuê đang chờ hoàn cọc/hoàn tiền không được báo khi chủ nhà trễ.
4. **Bản sao biên nhận cho payee**: RECEIPT_CONFIRMED chỉ tới payer (PRS:726). Payee tự xác nhận nên bỏ qua; payee tự động xác nhận nhận AUTO_CONFIRMED + PDF (bảng trên). Hoàn cọc: người thuê (payee) chỉ có biên nhận trong web nếu tự bấm xác nhận.
5. **Chưa có PDF hóa đơn tháng** (mục 2); quyết định chủ dự án "đính kèm PDF thật" chưa thực hiện được cho hóa đơn.
6. **Job khởi động xử lý đơn REVIEW cũ** (`MembershipReviewResolutionJob` -> `MPA:41-52`) sẽ phát ACTIVATED/OVERPAYMENT một lần cho đơn cũ: khi bật email sẽ có loạt email lịch sử; cần cờ chặn hoặc chấp nhận. Backfill biên nhận (`MembershipReceiptBackfill`, `backfillBatch` chỉ capture) **không** phát event, đúng.
7. Email hết hạn gói cần ngày hết hạn nhưng data `{}` (`AccountNotificationWriter:83`): thêm `expiresAt` vào data (NS validator chặt, sửa NS trước) hoặc endpoint nội bộ.
8. Đơn membership PENDING hết hạn/hủy không báo: chấp nhận được (chưa có tiền). Tiền vào muộn đúng số thì kích hoạt và có ACTIVATED (MPA:30-37).

### 3b. Đối chiếu `PAYMENT_RECEIPT_COVERAGE.md` (mọi dòng tạo biên nhận có quyết định thông báo)
| Dòng tiền tạo biên nhận | Thông báo hiện có | Quyết định email |
|---|---|---|
| Cọc giữ chỗ, tiền tháng đầu (qua `confirmLocked` PRS:719) | yêu cầu: RENTAL_REQUEST_ACCEPTED (module khác) / REQUEST_CREATED :248; xong: RECEIPT_CONFIRMED | Có + PDF |
| Hóa đơn tháng + phí trễ hạn (một phiếu/hóa đơn) | INVOICE_ISSUED, RECEIPT_CONFIRMED | Có; phiếu có PDF, hóa đơn không |
| Hóa đơn bổ sung kỳ cuối (CLS:323-326) | INVOICE_ISSUED | Có |
| Chênh lệch cọc theo phụ lục (PRS:310) | REQUEST_CREATED, RECEIPT_CONFIRMED | Có + PDF |
| Hoàn tiền đầu kỳ (PRS:977), hoàn cọc, số dư quyết toán (PRS:278) | REQUEST_CREATED, TRANSFER_REPORTED, RECEIPT_CONFIRMED / AUTO_CONFIRMED | Có + PDF (lỗ hổng 3, 4) |
| Gia hạn/hoãn/rollover hạn trả | INVOICE_EXTENSION_*, DEFERRED, ROLLED_OVER | Có, không có tiền nên không phiếu |
| Tổng = 0 (miễn) | không có (cố ý, PRS:185, `PaymentReceiptService:47-49`) | Không email |
| Membership SePay/ETH/nâng cấp/addon | ACTIVATED | Có + PDF (doc coverage còn ghi "không có phiếu", đã lỗi thời: cần cập nhật mục 0, 1, 3 và dòng 33-37) |
| Membership trả thừa | OVERPAYMENT_RECEIVED | Có + PDF (lỗ hổng 2) |
| Backfill phiếu cũ | không | Không email |

## 4. Việc cần làm (theo thứ tự)
**CORE**
1. Endpoint nội bộ (header `X-Internal-Secret`, kiểu `UserInternalController`): `GET /internal/payment-receipts/by-payment/{paymentId}` (trạng thái PDF, số biên nhận, số tiền) và `.../pdf` (bytes, bỏ kiểm actor nhưng giữ kiểm purpose/visibility/referenceId như `PaymentReceiptService:281-285`); tương tự `/internal/membership/receipts/{by-order|by-overpayment}/...`; email-context cho payment, invoice, membership expiry (số tiền, hạn, địa chỉ rút gọn, ngày hết hạn).
2. Thêm `overpaymentId` vào data MEMBERSHIP_OVERPAYMENT_RECEIVED (và `expiresAt` cho expiry nếu chọn cách này); cập nhật NS validator trước khi Core phát.
3. Endpoint admin đánh dấu "Đã hoàn" trả thừa + event MEMBERSHIP_OVERPAYMENT_REFUNDED; cân nhắc event cho payee khi nghĩa vụ quá hạn (lỗ hổng 3).
4. Quyết định về PDF hóa đơn tháng (sinh mới hay gửi không đính kèm) và cờ cho job REVIEW cũ.
5. Cập nhật `docs/PAYMENT_RECEIPT_COVERAGE.md` cho khớp hiện trạng membership.

**NS**
1. `EmailProvider.attachments` (base64, chặn tổng > 35MB) + test; `optedIn(userId, category)`; whitelist email theo eventType trong bảng mục 1 (29 loại Có), dispatcher render theo eventType.
2. `PaymentEmailContextClient` (Eureka + secret, như `user-email.directory.ts`) lấy context/PDF; job email chờ PDF READY, poll tối đa ~10 phút rồi gửi không đính kèm.
3. Template `templates/payment/*.hbs` + subject; sửa INVOICE_EXTENSION_EXPIRED thành email riêng (không gộp), INVOICE_AMOUNT_UPDATED = Không.
4. Xóa 10 mapping chết (7 DISPUTE, 3 PAYMENT_SUCCESSFUL/FAILED/OVERDUE); giữ MEMBERSHIP_PAYMENT_REVIEW tới khi Kafka sạch.
5. Migration cờ preferences PAYMENT/CONTRACT cho email; web `NotificationsSection.tsx` + mobile bật công tắc.

Rủi ro: quota Resend khi nhắc hạn/hóa đơn dồn một ngày (ưu tiên URGENT); PDF chứa tên và địa chỉ phòng nên chỉ gửi tới đúng người nhận; Kafka at-least-once nên phải giữ khóa chống trùng. Chưa chạy test, chưa đọc nội dung template PDF.
