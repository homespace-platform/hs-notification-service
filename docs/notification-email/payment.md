# Email module "Thanh toán & Hóa đơn" (PAYMENT) - kế hoạch (chỉ audit, chưa code)

Ký hiệu: NS = hs-notification-service, CORE = hs-core-api. Dòng `file:line` là bằng chứng; "(GĐ)" = giả định chưa kiểm chứng.

## 0. Sự thật nền tảng (ảnh hưởng thiết kế)
- Thanh toán là **chuyển khoản trực tiếp + bên nhận xác nhận** (không cổng thanh toán). "Thanh toán thành công" thực chất = `PAYMENT_RECEIPT_CONFIRMED` gửi cho **payer** (CORE `PaymentRequestService.java:726`). Không có producer cho `PAYMENT_SUCCESSFUL/FAILED/OVERDUE` (chỉ có template NS `notification-event.ts:189-206`).
- Event chỉ mang ID: payment = `{paymentId}` (NS `notification-event.ts:678`), invoice = `{contractId,invoiceId}` (`:686`), membership = `{orderId}` (CORE `MembershipNotificationWriter.java:~62`), expiry = `{}`. Copy không có số tiền (`:247-248`). Email cần số tiền/hạn nên phải **lấy thêm từ CORE** (mục 4).
- PDF chỉ có **biên nhận thanh toán** (`payment_receipts`, Gotenberg), KHÔNG có PDF hóa đơn tháng/đơn membership (grep `invoice.*pdf` chỉ ra DocumentConversionService của hợp đồng). Biên nhận chỉ tạo khi `CONFIRMED` và tổng > 0 (`PaymentReceiptService.java:45-49`), `capture` chạy cùng transaction nhưng **không render PDF** (`:41`). PDF do worker nền (15s/lần, tối đa 5 lần) tạo sau đó: `PaymentReceiptPdfWorker.java:36,60-116`, trạng thái `PENDING/FAILED/READY`, lưu `storage_objects` PRIVATE, purpose `PAYMENT_RECEIPT`. => khi event `RECEIPT_CONFIRMED` tới NS, PDF thường **chưa sẵn sàng**.
- Lấy PDF phía server: chỉ có **byte[]** `StorageServiceImpl.downloadDirect` (`:425`, bytes) qua `PaymentReceiptService.pdf` (`:274`, kiểm tra party theo actor, không dùng cho service-to-service). Không thấy API presign (GĐ: S3 bucket private nên không dùng URL `path` của Resend).
- NS email hiện chỉ cho SYSTEM: `EmailProvider.sendEmail` không có attachments (`email.provider.ts:8-16,69-77`); dispatcher render cứng `renderSystemBroadcastEmail` (`email-delivery.service.ts:9,130`); `optedIn` cứng `category==='SYSTEM'` (`email-outbox.ts:173-177`); `content()` chỉ trả title/body/priority (`:154-171`); job duy nhất theo `notificationId` (`:85-98`); Idempotency-Key `sourceEventId:recipientId` (`email-delivery.service.ts:135`).

## 1. Bảng event đang phát (CORE producer)
Trigger payment: `hs-payment-service/.../service/PaymentRequestService.java` (viết tắt PRS). Invoice: `hs-contract-service/.../service/MonthlyBillingService.java` (MBS). Settlement: `.../ContractLifecycleService.java` (CLS). Title lấy từ NS `notification-event.ts:250-376,453-461,472-474`.

| eventType | Trigger | Người nhận | Title hiện tại | Email? | Vì sao |
|---|---|---|---|---|---|
| PAYMENT_REQUEST_CREATED | PRS:248 (tiền thuê đầu kỳ trễ), :278 (quyết toán/hoàn cọc), :310 (điều chỉnh cọc), :977 (hoàn tiền) | payer | Có khoản thanh toán mới | Có | Có việc phải trả |
| PAYMENT_DUE_SOON | PaymentDueReminderScheduler:47 | payer | Sắp đến hạn thanh toán | Có | Nhắc hạn |
| PAYMENT_OBLIGATION_OVERDUE | PRS:323 | payer | Nghĩa vụ thanh toán cần được kiểm tra | Có | Quá hạn, rủi ro |
| PAYMENT_TRANSFER_REPORTED | PRS:559, PaymentProofUploadSessionService:387 | payee | Có khoản chuyển tiền cần xác nhận | Có | Bên nhận phải xác nhận trong hạn, nếu không bị tự xác nhận |
| PAYMENT_RECEIPT_CONFIRMED | PRS:726 | payer | Khoản thanh toán đã được xác nhận nhận tiền | **Có + PDF** | "Thanh toán thành công" |
| PAYMENT_RECEIPT_REJECTED | PRS:769 | payer | Bên nhận từ chối xác nhận khoản chuyển | Có | Phải xử lý lại |
| PAYMENT_RECEIPT_AUTO_CONFIRM_SOON | PRS:674 (once) | payee (GĐ) | Sắp tự động xác nhận đã nhận tiền | Có | Bên chậm chịu thiệt (deadline-default) |
| PAYMENT_REFUND_AUTO_CONFIRM_SOON | PRS:627 (once) | payee = người thuê (GĐ) | Sắp tự động xác nhận hoàn tiền | Có | Như trên |
| PAYMENT_RECEIPT_AUTO_CONFIRMED | PRS:608, :663 | payee | Hệ thống đã xác nhận thay bạn | Có | Hệ thống tự quyết định |
| INVOICE_METER_REMINDER | MBS:1220 | landlord | Cần chốt chỉ số hóa đơn | Không | Việc nội bộ chủ nhà, in-app đủ (bật sau nếu cần) |
| INVOICE_DRAFT_READY | MBS:1032 | landlord | Có hóa đơn tháng mới cần kiểm tra | Không | Nhắc nội bộ, dễ spam hàng tháng |
| INVOICE_ISSUED | MBS:999, CLS:326 | tenant | Hóa đơn tháng đã được phát hành | Có | Tenant cần số tiền/hạn |
| INVOICE_PAYMENT_REMINDER | MBS:1240 | tenant | Hóa đơn sắp đến hạn | Có | Nhắc hạn |
| INVOICE_OVERDUE | MBS:1124-1125 | landlord/both | Hóa đơn tháng đã quá hạn | Có | Quá hạn |
| INVOICE_AMOUNT_UPDATED | MBS:1128 | tenant | Số tiền hóa đơn đã được cập nhật | Có | Tiền phạt tăng, tránh chuyển sai |
| INVOICE_EXTENSION_REQUESTED | MBS:91 | landlord | Có yêu cầu gia hạn thanh toán hóa đơn | Có | Cần phản hồi |
| INVOICE_EXTENSION_APPROVED / _REJECTED | MBS:161 / :110 | tenant | ...được gia hạn / ...bị từ chối | Có | Đổi hạn trả |
| INVOICE_EXTENSION_EXPIRED | MBS:1090 | tenant | Yêu cầu gia hạn đã hết hạn | Gộp | Gộp vào email INVOICE_OVERDUE cùng hóa đơn |
| INVOICE_OVERDUE_ACTION_REQUIRED | MBS:1255 | landlord | Hóa đơn quá hạn cần chủ nhà xử lý | Có | Có hạn xử lý |
| INVOICE_OVERDUE_ACTION_RECORDED | MBS:490 | tenant | Chủ nhà đã ghi nhận một bước xử lý | Có | Ảnh hưởng thuê |
| INVOICE_OVERDUE_ACTION_ACKNOWLEDGED | MBS:517 | landlord | Đã ghi nhận phản hồi của người thuê | Không | Thông tin phụ |
| INVOICE_DEFERRED | MBS:554, :1158-1159 | tenant/both | Có quyết định chuyển khoản nợ sang hóa đơn sau | Có | Đổi nghĩa vụ |
| INVOICE_ROLLED_OVER | MBS:986 | tenant | Khoản chưa thanh toán đã chuyển sang hóa đơn khác | Có | QR/yêu cầu cũ bị hủy |
| SETTLEMENT_RESPONSE_NEEDED | CLS:201 | tenant | Có đề xuất hoàn cọc cần phản hồi | Có | Cần phản hồi trong hạn |
| SETTLEMENT_AGREED | CLS:260 | landlord | Đề xuất hoàn cọc đã được đồng ý | Có | Chủ nhà phải chuyển tiền |
| SETTLEMENT_DISPUTED | CLS:278 | landlord | Cần đối soát đề xuất hoàn cọc | Có | Cần xử lý |
| SETTLEMENT_PROPOSAL_INVALIDATED | CLS:334 | tenant | Đề xuất hoàn cọc cần được lập lại | Không | In-app đủ, sẽ có RESPONSE_NEEDED khi lập lại |
| SETTLEMENT_RESPONSE_OVERDUE | CLS:455 | tenant hoặc landlord | Phản hồi đề xuất hoàn cọc cần được kiểm tra | Có | Quá hạn |
| SETTLEMENT_PAYMENT_OVERDUE | CLS:466 | payer | Khoản hoàn cọc/quyết toán cần được kiểm tra | Có | Quá hạn tiền cọc |
| MEMBERSHIP_ACTIVATED | MembershipCheckoutService:225 (SePay), EthPaymentService:185 | owner | Gói đăng tin đã được kích hoạt | **Có** (không PDF) | Biên nhận mua gói |
| MEMBERSHIP_PAYMENT_REVIEW | MembershipCheckoutService:210,225 | owner | Đơn gói đăng tin cần đối soát | Có | Đã trả tiền nhưng chưa kích hoạt |
| MEMBERSHIP_EXPIRING_SOON / _EXPIRED | MembershipExpiryReminderScheduler:48-49 | user | Gói thành viên sắp hết hạn / đã hết hạn | Có | Gia hạn, mất quyền đăng tin |
| PAYMENT_DISPUTE_* (8 loại), PAYMENT_SUCCESSFUL/FAILED/OVERDUE | **không có producer** trong CORE (grep rỗng) | - | - | - | Xem mục 3 |

(RENTAL_CANCELLATION_REFUND_PENDING thuộc category rental-request, không tính ở đây.)

## 2. Chi tiết từng email "Có" (mẫu dùng chung: `renderEmail` + `components/detail-row`)
Chung: CTA = `MAIL_APP_BASE_URL` + `actionPath` có sẵn (`notification-event.ts:869` payment `/dashboard/payments?paymentId=`, `:881` invoice `/dashboard/invoices/{contractId}?section=monthly&invoice={id}`, settlement `settlementPath` `:11`, membership `/dashboard/membership`). Mặc định cờ: **BẬT** cho category PAYMENT (đề xuất: giao dịch, 1 công tắc; cần chủ dự án chốt, xem mục 4). Không đưa: số tài khoản đầy đủ (chỉ `bankName` + 4 số cuối nếu cần), tên chủ tài khoản, lý do tranh chấp/ghi chú tự do, link S3, secret.

| Email | Subject | Dòng chi tiết | Đính kèm | Idempotency key |
|---|---|---|---|---|
| Thanh toán thành công (RECEIPT_CONFIRMED) | `Thanh toán thành công - {receiptNumber}` | số biên nhận, loại khoản, số tiền, thời điểm xác nhận, mã hợp đồng/địa chỉ phòng | **Biên nhận PDF** `{receiptNumber}.pdf` (đã có, sinh bất đồng bộ, lấy bytes qua endpoint internal mới) | `payment-receipt:{paymentId}:{recipientId}` |
| Yêu cầu thanh toán mới | `Bạn có khoản cần thanh toán {amount}` | loại, số tiền, hạn | không | `sourceEventId:recipientId` |
| Nhắc hạn (PAYMENT_DUE_SOON, INVOICE_PAYMENT_REMINDER) | `Sắp đến hạn thanh toán {amount} ({period})` | kỳ, số tiền, hạn | không | như trên (event đã once theo kỳ) |
| Quá hạn (OBLIGATION/INVOICE/SETTLEMENT_PAYMENT_OVERDUE) | `Khoản thanh toán đã quá hạn` | số tiền, hạn, phí phạt hiện tại | không | như trên |
| Hóa đơn tháng (INVOICE_ISSUED) | `Hóa đơn tháng {MM/YYYY} - {address}` | kỳ, tổng, hạn, số điện/nước tổng (không chi tiết cá nhân) | **không có PDF hóa đơn** (cần sinh mới, ngoài phạm vi v1) | như trên |
| Chờ xác nhận nhận tiền / sắp tự xác nhận / đã tự xác nhận / bị từ chối | `Cần xác nhận khoản chuyển {amount}` ... | số tiền, mã tham chiếu CK, hạn xử lý | không | như trên |
| Gia hạn/hoãn/rollover/xử lý quá hạn, đề xuất hoàn cọc (RESPONSE_NEEDED, AGREED, DISPUTED, OVERDUE) | theo title in-app + mã kỳ/phòng | hạn phản hồi, số tiền đề xuất (chỉ tổng) | không | như trên |
| Membership kích hoạt/đối soát | `Gói đăng tin đã kích hoạt` / `Đơn gói cần đối soát` | tên gói, số tiền (`amountVnd`), thời điểm `paidAt`, mã giao dịch che giữa | không có PDF (cần sinh mới nếu muốn, GĐ v2) | như trên |
| Membership sắp/đã hết hạn | `Gói thành viên sắp hết hạn` | ngày hết hạn (lấy từ CORE vì data `{}`) | không | như trên |

## 3. Khoảng trống (chưa có thông báo)
1. **PDF biên nhận sẵn sàng / lỗi**: worker thất bại 5 lần là im lặng (`PaymentReceiptPdfWorker.java:73`); user không biết. Cần event hoặc retry-poll.
2. **Bên nhận (chủ nhà) không có email biên nhận** khi chính họ xác nhận; hoàn tiền: người thuê (payee) cũng không có. Đề xuất gửi bản sao PDF cho payee (event mới hoặc cùng job).
3. **PAYMENT_DISPUTE_*** (8 template NS `:284-310`) không có producer; hoặc luồng tranh chấp chưa phát event (cần kiểm tra DisputeCase code, GĐ). Khi có producer, dispute opened/proposed/escalated nên có email.
4. Đơn membership **hết hạn thanh toán / hủy** không có thông báo (chỉ REVIEW/PAID; `MembershipNotificationWriter` throws cho trạng thái khác).
5. Hóa đơn tháng chuyển **PAID** không báo cho chủ nhà (chủ nhà tự xác nhận nên chấp nhận được; chỉ cần nếu xác nhận tự động PRS:663, đã có AUTO_CONFIRMED cho payee).
6. Không có hóa đơn/biên nhận PDF cho **membership** và **hóa đơn tháng** trước khi trả.

## 4. Thay đổi theo repo
**CORE**
- Thêm endpoint internal (cùng kiểu `UserInternalController.java:21`, header `X-Internal-Secret`): `GET /internal/payments/{paymentId}/email-context` trả chỉ các trường an toàn (loại, số tiền, hạn, kỳ, địa chỉ phòng, receiptNumber, `receiptPdfStatus`, bank rút gọn) và `GET /internal/payment-receipts/by-payment/{paymentId}/pdf` trả bytes (wrap `PaymentReceiptService.pdf` bỏ check actor, kiểm purpose/visibility như `:279-285`). Tương tự `/internal/invoices/{invoiceId}/email-context`, `/internal/membership/orders/{orderId}/email-context`, `/internal/membership/expiry/{userId}`.
- Hoặc (chọn một): phát thêm event `PAYMENT_RECEIPT_PDF_READY {paymentId}` từ worker sau `setPdfStatus(READY)` (`PaymentReceiptPdfWorker.java:116`); khi đó email "thành công" gửi khi nhận event này (không phải RECEIPT_CONFIRMED). **Khuyến nghị**: email kích hoạt bởi RECEIPT_CONFIRMED, job retry-poll PDF (tái dùng retry của outbox) tối đa ~10 phút rồi gửi không đính kèm kèm link tải. Tránh sửa envelope (NS validator chặt key, `notification-event.ts:678`).
- Không đổi envelope hiện có; không đưa email/số tiền/PDF vào Kafka.

**NS**
- `EmailProvider`: thêm `attachments?: {filename, content(base64)}[]` vào `SendEmailInput` và body (`email.provider.ts:8-16,69-77`); chặn tổng > 35MB (Resend 40MB); test trong `email.provider.spec.ts`.
- `email-outbox.ts`: `optedIn(userId, category)` theo category; `content()` trả thêm `category, eventType, metadata`; thêm `EmailJob` trường `attachmentState`/`nextAttemptAt` cho poll PDF.
- `NotificationService.create`: mở điều kiện enqueue email theo whitelist eventType (hiện chỉ SYSTEM + PLATFORM_ANNOUNCEMENT, xem docs/EMAIL_RESEND.md) -> whitelist `PAYMENT_EMAIL_EVENTS` (các dòng "Có"/"Gộp" ở mục 1).
- Template: `templates/payment/{receipt-success,payment-request,reminder,overdue,invoice-issued,transfer-action,invoice-change,settlement,membership}.hbs` + `templates/payment/index.ts` (subject + render), xóa dòng trong README, test escape/link ở `email/email.spec.ts`. `UserEmailDirectory` giữ nguyên; thêm `PaymentEmailContextClient` (Eureka + secret như `user-email.directory.ts:15-44`).
- Gộp (`INVOICE_EXTENSION_EXPIRED`): job pending cùng `invoiceId` được hợp nhất trong cửa sổ 10 phút (GĐ).
- Preferences: migration cờ `emailOptInReset` kiểu mới cho PAYMENT (code cũ chỉ reset SYSTEM, `mongo-notification-preference.repository.ts:24-45`); chốt mặc định BẬT hay opt-in.

**Web/Mobile**: web `components/settings/sections/NotificationsSection.tsx` và mobile `NotificationSettingsScreen.tsx:293-309` đang hiện "(Sắp có)" cho email các mục khác: bật công tắc PAYMENT, thêm mô tả "gồm biên nhận PDF".

## 5. Rủi ro
- Quota Resend: hóa đơn hàng tháng/nhắc hạn dồn một ngày; dispatcher đã throttle (`EMAIL_SEND_INTERVAL_MS`, 20 job/tick) nhưng cần ngưỡng/ngày, ưu tiên URGENT trước.
- PDF: nhỏ (1 trang, GĐ < 300KB) nhưng base64 +33%; PDF chưa READY/FAILED -> gửi không đính kèm, đừng chặn email.
- Rò rỉ: PDF có thể chứa tên, địa chỉ phòng, số tiền (renderer không tham chiếu bank theo grep, cần xem mẫu HTML); email forwarding; không đặt link S3; log chỉ che email (đã có `maskEmail`).
- Gửi trùng: Kafka at-least-once; chống bằng job theo notificationId + Idempotency-Key Resend (chỉ 24h) -> không gửi lại nếu job `sent`.
- Event invoice chưa có paymentId: tra `MonthlyInvoice.paymentRequestId` ở CORE endpoint, không đoán ở NS.
- Email lệch trạng thái: copy event tĩnh vì trạng thái đổi sau (`notification-event.ts:316-318`); email phải đọc **trạng thái hiện tại** khi gửi, và bỏ qua nếu đã hết ý nghĩa (vd nhắc hạn nhưng đã CONFIRMED).

## 6. Checklist triển khai (theo thứ tự)
1. Chốt với chủ dự án: mặc định BẬT/TẮT, danh sách "Có", gửi bản sao PDF cho payee.
2. CORE: endpoint internal email-context + PDF bytes (+ test, secret guard); đảm bảo giới hạn kích thước PDF.
3. NS: attachments trong `EmailProvider` + test.
4. NS: tổng quát hóa `email-outbox` (optedIn theo category, content mở rộng) + whitelist PAYMENT.
5. NS: `PaymentEmailContextClient` + dispatcher theo `eventType`, retry-poll PDF.
6. NS: template `payment/*.hbs` + `index.ts` + test + `mail:preview`.
7. NS: migration preferences PAYMENT; cập nhật docs/EMAIL_RESEND.md.
8. Web + mobile: bật công tắc Email cho PAYMENT.
9. Pha 2: gap 1-4 (PDF lỗi, bản sao payee, dispute producer, membership hết hạn), PDF hóa đơn/membership.
10. Kiểm thử e2e trên staging (Resend sandbox), theo dõi quota 1 tuần rồi mở rộng.
