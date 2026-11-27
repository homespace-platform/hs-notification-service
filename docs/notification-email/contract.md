# Email cho module "Hợp đồng thuê & Đặt cọc" (kế hoạch, chỉ đọc code)

Ký hiệu: `CS` = `hs-core-api/hs-contract-service/src/main/java/com/hs/contract/`; `NS` = `hs-notification-service/src/modules/`; `NE` = `NS/notification-events/notification-event.ts`. Mọi event đi qua outbox `contract_notification_outbox` (`CS/notification/ContractNotificationPublisher.java:56-110`) -> Kafka v1, data chỉ có id (không tên, ngày, tiền). Nội dung/CTA dựng ở `NE`. [GT] = giả định chưa kiểm chứng.

## Hiện trạng email (căn cứ)
- Chỉ `SYSTEM` + `PLATFORM_ANNOUNCEMENT` có email (`docs/EMAIL_RESEND.md` "Bước 1"); `EmailDeliveryService.process` gọi cứng `renderSystemBroadcastEmail` và key `admin_` (`NS/notification-delivery/email-delivery.service.ts:128-135`). Job khóa theo `notificationId` (`email-outbox.ts:51`). `templates/contract/` chỉ có README.
- `EmailProvider.sendEmail` chưa có `attachments` (`email.provider.ts:7-14`, body `~:60`).
- Event legacy `CONTRACT_AWAITING_SIGNATURE/SIGNED/EXPIRED` (`NE:171-188`): không tìm thấy producer trong core (grep) [GT: chết].
- Danh mục khiếu nại map vào `RENTAL_REQUEST` chứ không phải `CONTRACT` (`NE:802`); digest map `SYSTEM` (`NE:812-820`).

## 1. Bảng event đang phát
Người nhận: CH=chủ nhà, KT=khách thuê, "bên kia"=bên không thao tác, 2B=cả hai. Email: Có / Không / Gộp (nhập vào email khác). Title lấy từ `NE`.

| eventType | Trigger (core) | Người nhận | Title hiện tại | Email | Vì sao |
|---|---|---|---|---|---|
| CONTRACT_AWAITING_SIGNATURE / CONTRACT_SIGNED / CONTRACT_EXPIRED | không có producer [GT] | - | Hợp đồng cần ký / đã được ký / đã hết hạn (`NE:171-188`) | Không | Legacy, thay bằng AGREEMENT_*; cân nhắc xóa |
| AGREEMENT_REVIEW_READY | `CS/service/impl/ContractServiceImpl.java:317,918`; `ContractAmendmentService:287`; `ContractLifecycleService:130`; `WorkflowDocumentService:65` | CH | `<Loại> cần bạn xem xét` | Không | Dồn nhiều loại văn bản, chỉ để CH xem; push/in-app đủ. Lượt ký ngay sau đó đã có email |
| AGREEMENT_SIGNING_TURN | `CS/service/impl/SmartCaSignatureServiceImpl.java:834`; `CS/deposit/DepositAgreementService.java:291`; `ContractServiceImpl:1123` | KT | Đến lượt bạn ký số ... | **Có** | Hành động có hạn, KT có thể không mở app |
| AGREEMENT_FULLY_SIGNED | `SmartCaSignatureServiceImpl:854-856` (cọc: fullySigned, thuê gốc: leaseActivated); `CS/service/WorkflowDocumentCommitter.java:22` | 2B (2 event) | `<Loại> đã đủ chữ ký số` | **Có** | Mốc pháp lý quan trọng nhất (cọc, thuê, phụ lục, gia hạn, chấm dứt sớm) |
| AGREEMENT_SIGNATURE_NEEDS_REVIEW | `SmartCaSignatureServiceImpl:937` | bên ký | Chữ ký số ... cần được kiểm tra | **Có** | Chữ ký có thể đã trừ ở VNPT nhưng chưa xác minh; cần xử lý |
| AGREEMENT_SIGNING_DUE_SOON | `CS/service/AgreementSigningReminderScheduler.java:94` (24h trước hạn, quét 5 phút) | bên chưa ký | Sắp hết hạn ký ... | **Có** | Quá hạn là bên trễ thua (xem memory deadline) |
| AMENDMENT_RESPONSE_NEEDED | `CS/service/ContractAmendmentService.java:131,155` | bên kia | Có yêu cầu điều chỉnh hợp đồng thuê | **Có** | Cần phản hồi trong hạn |
| AMENDMENT_DECIDED | `ContractAmendmentService:172,288` | bên kia | Yêu cầu điều chỉnh đã được phản hồi | Không | Nếu duyệt thì có SIGNING_TURN/REVIEW_READY |
| AMENDMENT_WITHDRAWN / AMENDMENT_EXPIRED | `:224,231` / `:363,369` (EXPIRED: 2B) | bên kia / 2B | Đã được rút / đã hết hạn | Không | Chỉ thông tin, xem in-app |
| AMENDMENT_APPLIED | `:376` | 2B | Phụ lục đã được áp dụng | **Có** | Điều khoản thuê đổi hiệu lực |
| LEASE_RENEWAL_WINDOW_OPENED | `CS/service/ContractLifecycleService.java:443` (1 lần/kỳ) | 2B | Đã đến thời gian xem xét gia hạn | **Có** | Tiền đề cho gia hạn; chỉ 1 lần/kỳ |
| RENEWAL_REQUESTED | `ContractLifecycleService:89` | CH | Có yêu cầu gia hạn hợp đồng thuê | **Có** | CH phải quyết định trong hạn |
| RENEWAL_APPROVED / RENEWAL_REJECTED | `:128-129` | KT | Được chấp thuận / bị từ chối | Gộp | APPROVED -> email lượt ký; REJECTED chỉ in-app |
| RENEWAL_EXPIRED | `:431` | 2B | Yêu cầu gia hạn đã hết hạn | Không | Thông tin |
| TERMINATION_RESPONSE_NEEDED | `CS/service/MutualTerminationService.java:53`; `MonthlyBillingService.java:592` | bên kia / KT | Có đề nghị chấm dứt sớm | **Có** | Cần phản hồi |
| TERMINATION_APPROVED | `MutualTerminationService:108` | bên kia | CH đồng ý đề nghị chấm dứt sớm | Gộp | Email lượt ký phụ lục đi kèm |
| TERMINATION_AGREED / TERMINATION_DECLINED | `MonthlyBillingService:624,646`; `MutualTerminationService:88` | CH / bên kia | Đã được đồng ý / bị từ chối | Không | Thông tin, in-app |
| TERMINATION_WITHDRAWN | `MutualTerminationService:89`; `MonthlyBillingService:670,1108`; `ContractLifecycleService:417-418` | bên kia | Đã được rút | Không | Thông tin |
| TERMINATION_NOTICE_ISSUED | `MonthlyBillingService.java:201` | KT | Có thông báo đơn phương chấm dứt | **Có** | URGENT, ảnh hưởng quyền ở; KT cần thấy ngay |
| TERMINATION_REVIEW_REQUESTED | `:227` | CH | Có yêu cầu xem xét quyết định chấm dứt | **Có** | Cần phản hồi trong hạn |
| TERMINATION_REVIEW_APPROVED / TERMINATION_NOTICE_CANCELLED | `:256` / `:274,344`; `ContractLifecycleService:417` | KT | Phương án thay thế được chấp thuận / Quyết định được rút | Không | Tin tốt, xem in-app |
| TERMINATION_ENDED | `:358,775` | 2B | Hợp đồng thuê đã chấm dứt | **Có** | Mốc kết thúc; dẫn đến trả nhà/quyết toán |
| LEASE_EXPIRED | `ContractLifecycleService:437` | 2B | Thời hạn thuê đã kết thúc | **Có** | Mở bước trả nhà (WAITING_HANDOVER) |
| LEASE_RETURN_CONFIRMED / LEASE_RETURN_COMPLETED | `ContractLifecycleService:542-543`; `MutualTerminationService:111-112`; `MonthlyBillingService:294` | bên kia | Có xác nhận trả nhà / Việc trả nhà đã được ghi nhận | Không | Thông tin; CTA vào quyết toán qua SETTLEMENT_* |
| SETTLEMENT_RESPONSE_NEEDED | `ContractLifecycleService:201` | KT | Có đề xuất hoàn cọc cần phản hồi | **Có** | Liên quan tiền cọc; quá hạn có hậu quả |
| SETTLEMENT_AGREED / SETTLEMENT_DISPUTED / SETTLEMENT_PROPOSAL_INVALIDATED | `:260` / `:278` / `:334` | CH / CH / KT | Đã được đồng ý / Cần đối soát / cần lập lại | Không | Thông tin trong luồng; cọc có thể vào Gộp sau |
| SETTLEMENT_RESPONSE_OVERDUE | `:455` | bên chưa phản hồi | Phản hồi đề xuất hoàn cọc cần được kiểm tra | **Có** | Đã quá hạn, cần xử lý |
| SETTLEMENT_PAYMENT_OVERDUE | `:466` | người phải trả | Khoản hoàn cọc/quyết toán cần được kiểm tra | **Có** | Tiền, đã quá hạn |
| LEASE_CLOSED | `:475` | 2B | Hồ sơ hoàn cọc đã đóng | **Có** | Mốc đóng cọc, bằng chứng cuối |
| COMPLAINT_OPENED / INFO_REQUESTED / DECIDED / FINAL_DECISION | `CS/notification/ComplaintNotificationWriter.java:46-70` | bên kia / bên liên quan / 2B | Có hồ sơ khiếu nại mới / Cần bổ sung / HomeSpace đã kết luận | **Có** | Có hạn/kết luận ảnh hưởng quyền lợi; không gửi cho ADMIN |
| COMPLAINT_COMMENTED / ESCALATED / ASSIGNED / CLOSED / REOPENED / WITHDRAWN / SOURCE_UPDATED | `:50-51,53,55-57,66-69` | các bên | tương ứng `NE:477-487` | Không | Tần suất cao (nhắn qua lại), dễ spam |
| BRANCH_DAILY_DIGEST | `CS/notification/BranchDigestScheduler.java:35` (08:00 ICT), `BranchDigestOutboxWriter.java:49` | CH có chi nhánh, count>0 | Việc cần chú ý hôm nay | **Có** (TẮT mặc định) | Xem mục 4 |

## 2. Đặc tả email cho các event "Có"
Chung: CTA = `MAIL_APP_BASE_URL` + `actionPath` do `NE` dựng (đã qua `isSafeActionPath`); sinh cùng nút "Mở hồ sơ". Idempotency-Key = `ct:<sourceEventId>:<recipientId>` (sourceEventId của FULLY_SIGNED là UUID riêng mỗi người nhận, `AgreementSigningNotificationWriter.java:~190`, nên 2 bên không trùng; DUE_SOON có id xác định theo (envelope, người, dueAt) `:105-112`). Giữ job khóa `notificationId` làm lớp 2 (Resend chỉ nhớ key 24h). Mặc định TẮT/BẬT: xem mục 4 (quyết định chủ sở hữu).
Dòng chi tiết an toàn (cần lấy từ Core, mục 4): loại văn bản, số hợp đồng, vai trò của người nhận, tên tin đăng/phòng (không địa chỉ), hạn xử lý (ngày giờ ICT). KHÔNG đưa: CCCD/số giấy tờ, địa chỉ đầy đủ, số tài khoản/ngân hàng, số tiền cọc/thuê/quyết toán (chỉ nói "có khoản cần xử lý"), email/SĐT bên kia, lý do khiếu nại, nội dung đề xuất trừ cọc.

| Event | Subject | Chi tiết | CTA (`NE`) | Đính kèm / link | Mặc định |
|---|---|---|---|---|---|
| AGREEMENT_FULLY_SIGNED | `[HomeSpace] <Loại> đã đủ chữ ký số` | loại, số HĐ, tin đăng, thời điểm đủ chữ ký, "bản đã ký có trong hồ sơ" | `/dashboard/contracts/{agreementId}?tab=sign` (`NE:894`; phụ lục chấm dứt sớm `tab=end`) | KHÔNG đính kèm; link đăng nhập (mục 3) | BẬT |
| AGREEMENT_SIGNING_TURN | `Đến lượt bạn ký số <loại>` | loại, số HĐ, hạn ký | cùng trên | link | BẬT |
| AGREEMENT_SIGNING_DUE_SOON | `Sắp hết hạn ký <loại>` (badge warning) | hạn ký, hậu quả "quá hạn hệ thống tự xử lý" | cùng trên | link | BẬT |
| AGREEMENT_SIGNATURE_NEEDS_REVIEW | `Chữ ký số <loại> cần được kiểm tra` (warning) | không nêu mã lỗi/nhà cung cấp | cùng trên | link | BẬT |
| AMENDMENT_RESPONSE_NEEDED / AMENDMENT_APPLIED | `Có yêu cầu điều chỉnh...` / `Phụ lục đã được áp dụng` | số HĐ, hạn phản hồi / ngày hiệu lực; không nêu giá trị đổi | `contracts/{id}?tab=end` / `?tab=content` (`NE:903`) | link | BẬT |
| LEASE_RENEWAL_WINDOW_OPENED, RENEWAL_REQUESTED | `Đến lúc xem xét gia hạn...` / `Có yêu cầu gia hạn...` | số HĐ, ngày kết thúc hiện tại, hạn phản hồi | `?tab=end` (`NE:909`) | link | BẬT |
| TERMINATION_RESPONSE_NEEDED, TERMINATION_NOTICE_ISSUED (urgent), TERMINATION_REVIEW_REQUESTED, TERMINATION_ENDED, LEASE_EXPIRED | theo title `NE:437-448` | số HĐ, hạn phản hồi/ngày kết thúc; không nêu lý do | `?tab=end`; đơn phương: `/dashboard/invoices/{id}?section=monthly` (`NE:915`) | link | BẬT |
| SETTLEMENT_RESPONSE_NEEDED, _RESPONSE_OVERDUE, _PAYMENT_OVERDUE, LEASE_CLOSED | theo title `NE:456-462` | số HĐ, hạn, "có khoản cần xử lý" | `/dashboard/invoices/{id}?section=deposit` (`NE:11`) | link | BẬT |
| COMPLAINT_OPENED/INFO_REQUESTED/DECIDED/FINAL_DECISION | theo title `NE:477-483` | số hồ sơ (caseId rút gọn), hạn bổ sung | `/dashboard/complaints?requestId=..&complaintId=..` (`NE:804`) | link | BẬT |
| BRANCH_DAILY_DIGEST | `Hôm nay bạn có N việc cần chú ý` | N (đã có), không liệt kê chi nhánh [GT: payload hiện chỉ có `attentionCount`] | `/dashboard/branches` | không | TẮT |

## 3. Đính kèm PDF hay link (khuyến nghị: link đăng nhập, không đính kèm)
- PDF đã ký (`SIGNED_FINAL`) bị chặn presign trực tiếp: `requiresVerifiedAccess` (`CS/service/ContractStorageAccessChecker.java:28-34`, `hs-storage-service/.../StorageServiceImpl.java:603-606`). Chỉ phát qua `/contracts/documents/{id}/content` có kiểm tra toàn vẹn/blockchain (`hs-api-service/.../ContractDocumentIntegrityController.java:29-47`). Presign 5 phút (`application.properties:127`) vô dụng trong email.
- PDF chứa dữ liệu nhạy cảm (snapshot hai bên, tài sản, tài chính: `ContractServiceImpl.java:1435-1450`) [GT: có CCCD/địa chỉ/ngân hàng]. Email không mã hóa, dễ chuyển tiếp/lưu hộp thư; mất kiểm soát thu hồi, lệch yêu cầu "hash đúng bytes đã ký".
- Resend cho attachment base64/path, tổng 40MB, base64 phình ~33%; `EmailProvider` chưa hỗ trợ.
- Phương án: email dẫn tới `/dashboard/contracts/{id}?tab=sign` (đăng nhập, phân quyền theo bên, có xác minh toàn vẹn). Nếu chủ sở hữu vẫn muốn đính kèm: tùy chọn riêng của người dùng, mặc định TẮT, chỉ FULLY_SIGNED, Core thêm endpoint nội bộ trả bytes qua `ContractDocumentIntegrityService.content` (không dùng `downloadDirect` vì bỏ qua kiểm tra), giới hạn ≤10MB, không đưa bytes vào Kafka.

## 4. Quyết định, khoảng trống, thay đổi theo repo
**Digest chủ nhà**: lợi ích thấp (chỉ một con số, `BranchDigestOutboxWriter.java:56`), nhưng hợp với chủ nhà nhiều chi nhánh. Gửi dưới cờ `SYSTEM` (đã opt-in, tắt mặc định) và cần bật cho `BRANCH_DAILY_DIGEST` ngoài `PLATFORM_ANNOUNCEMENT` (gate hiện tại ở `NotificationService.create`). Eventid xác định theo (owner, ngày) nên không trùng.
**Mặc định**: cờ `email` của mục CONTRACT hiện là mặc định cũ `true` không phải đồng ý (cách xử lý SYSTEM trong `EMAIL_RESEND.md`). Đề xuất email giao dịch BẬT mặc định sau một lần reset đánh dấu `emailOptInReset` theo từng mục [cần chủ sở hữu duyệt: BẬT mặc định hay opt-in]. Khiếu nại phải đi theo toggle "Hợp đồng", gate theo eventType chứ không theo category.

**Khoảng trống (chưa có thông báo, nên thêm kèm email)**
1. Hạn cuối thông báo vi phạm (default notice) sắp tự hủy: reminder bỏ qua đúng trường hợp này (`AgreementSigningReminderScheduler.java:92`), phát notice ở `RentalOnboardingService.java:653`, tự chấm dứt ở `:713`. Cần `DEFAULT_FINAL_DUE_SOON` (24h trước).
2. Sắp hết hạn phản hồi phụ lục/gia hạn (`ContractAmendmentService:361-369`, `ContractLifecycleService:424-426`: chỉ có EXPIRED sau khi hết hạn): `AMENDMENT/RENEWAL_DUE_SOON`.
3. Sắp quá hạn phản hồi đề xuất hoàn cọc (`:451-455`, chỉ có OVERDUE sau): `SETTLEMENT_RESPONSE_DUE_SOON`; bên trễ chịu thiệt nên cần cảnh báo trước.
4. Hợp đồng sắp hết hạn: chỉ có WINDOW_OPENED một lần (`:441-444`); thiếu nhắc T-30/T-7 ngày trước ngày kết thúc.
5. Quá hạn trả nhà sau EXPIRED (`:436` tạo WAITING_HANDOVER) không có nhắc nếu không ai xác nhận.
6. Khách xem xét quyết định đơn phương sắp hết hạn (`terminationReviewHours`, `MonthlyBillingSchedule.java:27`): thiếu nhắc.
7. Bổ sung khiếu nại: hạn của INFO_REQUESTED sắp tới. (Ngoài module: nhắc tự xác nhận nhận tiền thuộc PAYMENT, không lặp ở đây.)

**Thay đổi theo repo**
- hs-notification-service: (a) tách `EmailDeliveryService.process` khỏi `renderSystemBroadcastEmail`; registry eventType -> hàm render trong `templates/contract/{index.ts,*.hbs}` + test `email.spec.ts`; (b) job lưu `eventType` (hoặc đọc từ notification), key `ct:<sourceEventId>:<recipientId>`; (c) allowlist event gửi email thay gate SYSTEM-only; (d) `UserEmailDirectory` thêm lấy tóm tắt an toàn từ Core; (e) preference mặc định theo mục + reset; (f) `EmailProvider` thêm `attachments?` chỉ khi làm mục 3; (g) cập nhật README và `EMAIL_RESEND.md`.
- hs-core-api: endpoint nội bộ `/internal/**` (mẫu `/internal/users/emails`, `X-Internal-Secret`) trả `{loại, số HĐ, vai trò, tên tin, hạn}` và kiểm tra userId thuộc đúng hợp đồng; KHÔNG đổi envelope Kafka (consumer từ chối thuộc tính lạ). Thêm event mới cho các khoảng trống 1-7 vào `AgreementSigningReminderScheduler`/`ContractLifecycleService` (id xác định theo (đối tượng, người, hạn)).
- hs-web: bật công tắc Email của mục Hợp đồng (đang "Sắp có"); nội dung trang đích đã có.

**Rủi ro**: (1) event mới phải deploy consumer (`NE`) trước producer, nếu không vào DLT; (2) Resend 2 req/s, hạn mức gói; 500ms/mail giãn burst FULLY_SIGNED cuối tháng; (3) email lộ sự tồn tại hợp đồng/khiếu nại khi hộp thư bị chia sẻ: giữ nội dung trung tính; (4) email thay đổi/chưa xác minh: directory chỉ trả user active; (5) email đến trước khi CH/KT thấy in-app, không được nêu "đã áp dụng" hay "đã thanh toán" nếu chưa chắc (giữ văn phong `NE:407,422`); (6) spam khiếu nại nếu mở rộng.

**Checklist thực hiện**
1. Chủ sở hữu chốt mặc định BẬT/TẮT + chính sách đính kèm.
2. NS: registry render + template contract + test (chưa gửi thật).
3. NS: mở allowlist cho FULLY_SIGNED trước (một event), idempotency key, test trùng/opt-out/Core lỗi.
4. Core: endpoint tóm tắt nội bộ + test chặn user ngoài hợp đồng.
5. Mở dần các event "Có", preference + reset, web công tắc.
6. Thêm event khoảng trống (consumer trước), từng cái một.
7. Digest (TẮT mặc định) sau cùng; cập nhật docs; chạy `npm test -- --runInBand`, `npx tsc --noEmit`, preview bằng `mail:preview`.
