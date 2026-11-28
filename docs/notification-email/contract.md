# Email cho module "Hợp đồng thuê & Đặt cọc" (kiểm tra lại 28/11, chỉ đọc code)

Ký hiệu: `CS` = `hs-core-api/hs-contract-service/src/main/java/com/hs/contract/`; `NE` = `hs-notification-service/src/modules/notification-events/notification-event.ts`; `ND` = `.../notification-delivery/`. Mọi event đi qua outbox `contract_notification_outbox` -> Kafka v1, data chỉ có id (không tên/ngày/tiền). Nội dung và CTA dựng ở `NE`. (giả định) = chưa kiểm chứng.

## Hiện trạng và thay đổi so với bản trước
- Số liệu chung: Core phát **49 eventType** của module (cả 2 danh mục CONTRACT và các nhóm đi kèm), tất cả đều được `NE` map (không có event Core phát mà consumer không biết). **3 event chết**: `CONTRACT_AWAITING_SIGNATURE/SIGNED/EXPIRED` (`NE:171-188`), grep không có producer (chỉ còn trong spec và `AiContractQueryService` dùng chuỗi khác nghĩa) -> xóa khỏi `NE` cùng spec.
- Mới so với bản trước: (1) `SYSTEM_INCIDENT_OPENED/RESOLVED` do `CS/notification/OperationalIncidentService.java:35` phát cho **mọi admin active** khi bằng chứng blockchain lỗi (`CS/blockchain/worker/ContractDocumentProofWorker.java:192-194`), map `NE:495-497` category SYSTEM; (2) khiếu nại có thêm `audience` PARTY/ADMIN, `intake` gửi cho mọi admin khi chuyển HomeSpace (`ComplaintNotificationWriter.java:47,53,92-98`), link admin `/operations/complaints` (`NE:~806`); (3) digest vẫn category SYSTEM (`NE:818-826`). Chưa có gì khác đổi ở Core/NS: số dòng của producer cũ đã đối chiếu và còn đúng.
- Nền email: vẫn chỉ SYSTEM + `PLATFORM_ANNOUNCEMENT` (`notification.service.ts:112-114`, `ND/email-outbox.ts:173-177`, `ND/email-delivery.service.ts:9,128` gọi cứng `renderSystemBroadcastEmail`). `EmailProvider` chưa có `attachments` (`ND/email.provider.ts:8-15,64`). Job khóa `notificationId` (`email-outbox.ts:51`). `templates/contract/` chỉ có README.
- Khiếu nại vẫn map category `RENTAL_REQUEST`, không phải `CONTRACT` (`NE:~802`); app hiện tab "Yêu cầu thuê", nên toggle email phải gate theo eventType (xem mục 4).

## 1. Bảng đầy đủ event Core đang phát
Người nhận: CH=chủ nhà, KT=khách thuê, "bên kia"=bên không thao tác, 2B=cả hai, AD=admin. Email: Có / Không / Gộp. Title lấy từ `NE`.

| eventType | Khi nào phát (file:line) | Người nhận | Title hiện tại | Email | Lý do |
|---|---|---|---|---|---|
| CONTRACT_AWAITING_SIGNATURE, CONTRACT_SIGNED, CONTRACT_EXPIRED | không có producer | - | Hợp đồng cần ký / đã được ký / hết hạn (`NE:171-188`) | Không | CHẾT: bug dọn dẹp, thay bằng AGREEMENT_* |
| AGREEMENT_REVIEW_READY | `CS/service/impl/ContractServiceImpl.java:317,918`; `ContractAmendmentService:287`; `ContractLifecycleService:130`; `WorkflowDocumentService:65` | CH | `<Loại> cần bạn xem xét` | **Có** (đổi so với bản trước) | Bước đầu CH phải xem và ký; trước đây chỉ có DUE_SOON 24h và chỉ cho HĐ thuê gốc (`AgreementSigningReminderScheduler:58-59`); CH trễ thì thua |
| AGREEMENT_SIGNING_TURN | `SmartCaSignatureServiceImpl:834`; `CS/deposit/DepositAgreementService.java:291` (mở lại hạn ký cọc); `ContractServiceImpl:1123` | KT | `Đến lượt bạn ký số <loại>` | **Có** | Hành động có hạn |
| AGREEMENT_FULLY_SIGNED | `SmartCaSignatureServiceImpl:854-856` (cọc / thuê gốc / phụ lục-gia hạn); `CS/service/WorkflowDocumentCommitter.java:22` (chấm dứt sớm) | 2B (mỗi người 1 event) | `<Loại> đã đủ chữ ký số` | **Có + đính kèm PDF** | Mốc pháp lý chính; chủ sở hữu muốn có bản PDF đã ký |
| AGREEMENT_SIGNATURE_NEEDS_REVIEW | `SmartCaSignatureServiceImpl:937` | bên ký | Chữ ký số ... cần được kiểm tra | **Có** | Chữ ký có thể đã trừ ở VNPT nhưng chưa xác minh |
| AGREEMENT_SIGNING_DUE_SOON | `CS/service/AgreementSigningReminderScheduler.java:94` (24h trước hạn, quét 5 phút) | bên chưa ký | Sắp hết hạn ký ... | **Có** | Quá hạn bên trễ thua |
| AMENDMENT_RESPONSE_NEEDED | `CS/service/ContractAmendmentService.java:131,155` | bên kia | Có yêu cầu điều chỉnh hợp đồng thuê | **Có** | Phản hồi trong hạn |
| AMENDMENT_DECIDED | `ContractAmendmentService:172,288` | bên kia | Yêu cầu điều chỉnh đã được phản hồi | Không | Nếu duyệt thì có REVIEW_READY/SIGNING_TURN |
| AMENDMENT_WITHDRAWN / AMENDMENT_EXPIRED | `:224,231` / `:363,369` (EXPIRED: 2B) | bên kia / 2B | Đã được rút / đã hết hạn | Không | Chỉ thông tin |
| AMENDMENT_APPLIED | `:376` | 2B | Phụ lục đã được áp dụng | **Có** (không đính kèm) | Điều khoản đổi hiệu lực; PDF đã gửi ở FULLY_SIGNED của phụ lục |
| LEASE_RENEWAL_WINDOW_OPENED | `CS/service/ContractLifecycleService.java:443` (1 lần/kỳ) | 2B | Đã đến thời gian xem xét gia hạn | **Có** | Tiền đề gia hạn |
| RENEWAL_REQUESTED | `ContractLifecycleService:89` | CH | Có yêu cầu gia hạn hợp đồng thuê | **Có** | CH quyết định trong hạn |
| RENEWAL_APPROVED | `:128` | KT | Yêu cầu gia hạn được chấp thuận | Gộp | KT nhận email SIGNING_TURN khi CH ký xong; trước đó chỉ in-app |
| RENEWAL_REJECTED / RENEWAL_EXPIRED | `:129` / `:431` (2B) | KT / 2B | Bị từ chối / đã hết hạn | Không | Thông tin |
| TERMINATION_RESPONSE_NEEDED | `CS/service/MutualTerminationService.java:53`; `MonthlyBillingService.java:592` | bên kia / KT | Có đề nghị chấm dứt sớm | **Có** | Cần phản hồi |
| TERMINATION_APPROVED | `MutualTerminationService:108` | bên kia | Chủ nhà đã đồng ý đề nghị chấm dứt sớm | Gộp | Email SIGNING_TURN/FULLY_SIGNED của phụ lục chấm dứt đi sau |
| TERMINATION_AGREED / TERMINATION_DECLINED | `MonthlyBillingService:624,646`; `MutualTerminationService:88` | CH / bên kia | Đã được đồng ý / bị từ chối | Không | Thông tin |
| TERMINATION_WITHDRAWN | `MutualTerminationService:89`; `MonthlyBillingService:670,1108`; `ContractLifecycleService:417-418` | bên kia | Đã được rút | Không | Thông tin |
| TERMINATION_NOTICE_ISSUED | `MonthlyBillingService.java:201` | KT | Có thông báo đơn phương chấm dứt (URGENT) | **Có** | Ảnh hưởng quyền ở |
| TERMINATION_REVIEW_REQUESTED | `:227` | CH | Có yêu cầu xem xét quyết định chấm dứt | **Có** | Phản hồi trong hạn |
| TERMINATION_REVIEW_APPROVED / TERMINATION_NOTICE_CANCELLED | `:256` / `:274,344`; `ContractLifecycleService:417` | KT | Phương án thay thế được chấp thuận / Quyết định được rút | Không | Tin tốt, xem in-app |
| TERMINATION_ENDED | `:358,775` | 2B | Hợp đồng thuê đã chấm dứt | **Có** | Mốc kết thúc, dẫn tới trả nhà/quyết toán |
| LEASE_EXPIRED | `ContractLifecycleService:437` | 2B | Thời hạn thuê đã kết thúc | **Có** | Mở bước trả nhà (WAITING_HANDOVER) |
| LEASE_RETURN_CONFIRMED / LEASE_RETURN_COMPLETED | `ContractLifecycleService:542-543`; `MutualTerminationService:111-112`; `MonthlyBillingService:294` | bên kia | Có xác nhận trả nhà / Việc trả nhà đã được ghi nhận | Không | Thông tin; tiếp theo là SETTLEMENT_* |
| SETTLEMENT_RESPONSE_NEEDED | `ContractLifecycleService:201` | KT | Có đề xuất hoàn cọc cần phản hồi | **Có** | Tiền cọc, quá hạn có hậu quả |
| SETTLEMENT_AGREED / SETTLEMENT_DISPUTED / SETTLEMENT_PROPOSAL_INVALIDATED | `:260` / `:278` / `:334` | CH / CH / KT | Đã được đồng ý / Cần đối soát / cần lập lại | Không | Thông tin trong luồng |
| SETTLEMENT_RESPONSE_OVERDUE | `:455` | bên chưa phản hồi | Phản hồi đề xuất hoàn cọc cần được kiểm tra | **Có** | Quá hạn, cần xử lý |
| SETTLEMENT_PAYMENT_OVERDUE | `:466` | người phải trả | Khoản hoàn cọc/quyết toán cần được kiểm tra | **Có** | Tiền, quá hạn |
| LEASE_CLOSED | `:475` | 2B | Hồ sơ hoàn cọc đã đóng | **Có** | Mốc đóng cọc |
| COMPLAINT_OPENED / INFO_REQUESTED / DECIDED / FINAL_DECISION | `CS/notification/ComplaintNotificationWriter.java:46,63,65,70` | bên kia / bên được yêu cầu / 2B (audience PARTY) | Có hồ sơ khiếu nại mới / Cần bổ sung / HomeSpace đã kết luận | **Có** (chỉ audience PARTY) | Hạn hoặc kết luận ảnh hưởng quyền lợi |
| COMPLAINT_COMMENTED / ESCALATED / ASSIGNED / CLOSED / REOPENED / WITHDRAWN / SOURCE_UPDATED | `:50-51,53,55-57,66-69` | bên liên quan; AD khi audience ADMIN | tương ứng `NE:484-493` | Không | Tần suất cao; admin dùng cổng vận hành |
| BRANCH_DAILY_DIGEST | `CS/notification/BranchDigestScheduler.java:35` (08:00 ICT), `BranchDigestOutboxWriter.java:49` | CH có chi nhánh, count>0 | Việc cần chú ý hôm nay | **Có** (TẮT mặc định) | Hợp với CH nhiều chi nhánh; xem mục 4 |
| SYSTEM_INCIDENT_OPENED | `OperationalIncidentService.java:35` (từ `ContractDocumentProofWorker:192-194`) | AD (mọi admin active) | Hệ thống có sự cố cần kiểm tra (URGENT) | **Có** (chỉ AD, gộp theo component) | Proof blockchain lỗi >=3 lần hoặc FAILED; admin có thể không mở app |
| SYSTEM_INCIDENT_RESOLVED | cùng file, nhánh `failing=false` | AD | Sự cố hệ thống đã phục hồi | Không | Thông tin |

Đếm: 49 event đang phát = Có 24, Gộp 2, Không 23; thêm 3 event chết. Event Core phát mà consumer không map (vào DLT): 0.

## 2. Đặc tả email "Có"
Chung: CTA = `MAIL_APP_BASE_URL` + `actionPath` do `NE` dựng (đã qua `isSafeActionPath`), nút "Mở hồ sơ". Idempotency-Key = `ct:<sourceEventId>:<recipientId>`; FULLY_SIGNED mỗi người nhận có eventId UUID riêng (`AgreementSigningNotificationWriter.java:~86`), DUE_SOON có id xác định theo (envelope, người, dueAt) (`:137`), digest theo (owner, ngày) (`BranchDigestOutboxWriter:42-43`). Giữ job khóa `notificationId` làm lớp 2 (Resend chỉ nhớ key 24h). Mặc định BẬT cho 22 event giao dịch (theo công tắc mục "Hợp đồng", cần reset opt-in 1 lần, chủ sở hữu duyệt); TẮT cho digest; SYSTEM_INCIDENT chỉ admin, BẬT.
Dòng chi tiết được phép (lấy từ Core, mục 4): loại văn bản, số hợp đồng, vai trò người nhận, tên tin đăng/phòng (không địa chỉ), hạn xử lý (giờ ICT). KHÔNG đưa trong thân email: CCCD, địa chỉ đầy đủ, ngân hàng, số tiền cọc/thuê/quyết toán, email/SĐT bên kia, lý do khiếu nại, nội dung đề xuất trừ cọc.

| Event | Subject | Chi tiết | Nút (`NE`) | Đính kèm | Mặc định |
|---|---|---|---|---|---|
| AGREEMENT_FULLY_SIGNED | `[HomeSpace] <Loại> đã đủ chữ ký số` | loại, số HĐ, tin đăng, thời điểm đủ chữ ký, "bản PDF đã ký đính kèm" | `/dashboard/contracts/{agreementId}?tab=sign` (`NE:894`; chấm dứt sớm `tab=end`) | **PDF đã ký, xem mục 3** | BẬT |
| AGREEMENT_REVIEW_READY | `<Loại> cần bạn xem xét và ký` | loại, số HĐ, hạn nếu có | cùng trên | không (bản nháp chưa ký) | BẬT |
| AGREEMENT_SIGNING_TURN | `Đến lượt bạn ký số <loại>` | loại, số HĐ, hạn ký | cùng trên | không | BẬT |
| AGREEMENT_SIGNING_DUE_SOON | `Sắp hết hạn ký <loại>` (warning) | hạn ký, "quá hạn hệ thống tự xử lý" | cùng trên | không | BẬT |
| AGREEMENT_SIGNATURE_NEEDS_REVIEW | `Chữ ký số <loại> cần được kiểm tra` | không nêu mã lỗi/nhà cung cấp | cùng trên | không | BẬT |
| AMENDMENT_RESPONSE_NEEDED / AMENDMENT_APPLIED | `Có yêu cầu điều chỉnh...` / `Phụ lục đã được áp dụng` | số HĐ, hạn phản hồi / ngày hiệu lực; không nêu giá trị đổi | `?tab=end` / `?tab=content` (`NE:903-909`) | không | BẬT |
| LEASE_RENEWAL_WINDOW_OPENED, RENEWAL_REQUESTED | `Đến lúc xem xét gia hạn...` / `Có yêu cầu gia hạn...` | số HĐ, ngày kết thúc, hạn phản hồi | `?tab=end` (`NE:909`) | không | BẬT |
| TERMINATION_RESPONSE_NEEDED, NOTICE_ISSUED (urgent), REVIEW_REQUESTED, ENDED, LEASE_EXPIRED | theo title `NE:444-454` | số HĐ, hạn phản hồi / ngày kết thúc; không nêu lý do | `?tab=end`; đơn phương: `/dashboard/invoices/{id}?section=monthly` (`NE:11-13,915`) | không | BẬT |
| SETTLEMENT_RESPONSE_NEEDED, _RESPONSE_OVERDUE, _PAYMENT_OVERDUE, LEASE_CLOSED | theo title `NE:462-468` | số HĐ, hạn, "có khoản cần xử lý" | `/dashboard/invoices/{id}?section=deposit` (`NE:11`) | không | BẬT |
| COMPLAINT_OPENED/INFO_REQUESTED/DECIDED/FINAL_DECISION (audience PARTY) | theo title `NE:483-489` | số hồ sơ rút gọn, hạn bổ sung | `/dashboard/complaints?requestId=..&complaintId=..` | không | BẬT |
| BRANCH_DAILY_DIGEST | `Hôm nay bạn có N việc cần chú ý` | N (payload chỉ có `attentionCount`) | `/dashboard/branches` | không | TẮT |
| SYSTEM_INCIDENT_OPENED (admin) | `[HomeSpace] Sự cố hệ thống: <BLOCKCHAIN/GATEWAY>` | thành phần, thời điểm mở | `/operations/system-alerts?incidentId=` | không | BẬT (admin) |

## 3. Đính kèm PDF đã ký (quyết định chủ sở hữu 28/11: đính kèm bản thật, đọc từ S3, qua endpoint nội bộ của Core)
- Vì sao không đọc S3 trực tiếp từ NS: PDF `SIGNED_FINAL` bị chặn presign (`CS/service/ContractStorageAccessChecker.java:26-33`, `hs-storage-service/.../StorageServiceImpl.java:603-606`); bucket private; chỉ Core biết `storageObjectId`, hash, kiểm tra blockchain.
- Cái đã có: `ContractDocumentIntegrityService` (`CS/blockchain/api/ContractDocumentIntegrityService.java:30`) đọc bytes bằng `downloadDirect` (giới hạn 50MB) rồi so SHA-256 với `signedSha256`/proof và on-chain; trả `MATCH/PENDING/NOT_AVAILABLE/MISMATCH/MISSING/UNAVAILABLE`. **Không dùng được nguyên trạng**: `inspect` yêu cầu `UserContextHolder` có user (`:56-59`), `contentForAdmin` cũng vậy; route công khai `/contracts/documents/{id}/content` (`hs-api-service/.../ContractDocumentIntegrityController.java:29-47`) cần JWT.
- **Việc Core phải làm**: endpoint `POST /internal/contracts/agreements/{agreementId}/signed-pdf` (mẫu `UserInternalController`, `X-Internal-Secret`, không đi qua Gateway), body `{recipientId}`. Logic: (1) kiểm tra `recipientId` bằng `landlordId` hoặc `tenantId` của envelope; (2) chọn PDF `SIGNED_FINAL`, `READY`, revision hiện tại, mới nhất (logic có sẵn `ContractServiceImpl.signedFinalPdf:1415-1424`); (3) thêm biến thể `contentForSystem(documentId)` của `inspect` bỏ qua kiểm tra user/ACL nhưng GIỮ nguyên toàn bộ kiểm tra hash/proof/on-chain; (4) trả bytes + header `X-Document-Integrity`, `X-Document-Sha256`, tên file (`<số HĐ>_da_ky_hai_ben.pdf`, `SmartCaSignatureServiceImpl:746`). Phủ mọi loại: cọc, thuê gốc, phụ lục, gia hạn, chấm dứt sớm (đều là envelope `SIGNED_FINAL`).
- Quy tắc NS khi gọi: `MATCH` hoặc `PENDING` (khớp hash lúc ký, blockchain chưa xác nhận: lúc email gửi gần như luôn `PENDING`, không viết "đã xác nhận blockchain") -> đính kèm. `UNAVAILABLE` hoặc 5xx -> retry có backoff (giả định 5 lần/30 phút), hết lượt thì gửi email KHÔNG đính kèm, kèm dòng "xem bản đã ký trong hồ sơ". `MISMATCH`/`MISSING`/`NOT_AVAILABLE` -> KHÔNG đính kèm (không gửi file chưa xác thực), vẫn gửi email thông báo mốc, và Core ghi incident cho admin (tái dùng `incidents.observe`). Bytes không đi qua Kafka và không lưu Mongo; NS giữ trong bộ nhớ đến lúc gửi.
- NS: `SendEmailInput.attachments?: {filename, content(base64)}[]` (`email.provider.ts:8-15`, body `:~64`), chặn tổng >35MB (Resend 40MB, base64 phình ~33%, nên đặt trần PDF ~25MB, giả định) và đặt thời gian chờ riêng; job email cần trạng thái `attachmentState`/`nextAttemptAt` để retry không gửi trùng (Idempotency-Key giữ cố định giữa các lần retry).
- Rủi ro bắt buộc nêu: PDF chứa dữ liệu nhạy cảm của hai bên (snapshot `ContractServiceImpl:1435-1450`, giả định có CCCD/địa chỉ/tài khoản ngân hàng); email không mã hóa và dễ chuyển tiếp -> chỉ gửi tới đúng hai bên của hợp đồng, địa chỉ lấy từ directory (user active), thân email vẫn trung tính, log chỉ che email (`maskEmail`). Hồ sơ có `MISMATCH` thì không bao giờ đính kèm.

## 4. Quyết định còn lại và thiếu thông báo
**Digest**: giá trị thấp (chỉ một con số), chỉ cho CH nhiều chi nhánh; gửi dưới category SYSTEM (đã opt-in, tắt mặc định) nên phải mở allowlist `BRANCH_DAILY_DIGEST` ngoài `PLATFORM_ANNOUNCEMENT` (gate `notification.service.ts:112`). **Mặc định**: cờ `email` mục CONTRACT hiện là `true` mặc định cũ chứ không phải đồng ý; đề xuất BẬT mặc định sau một lần reset `emailOptInReset` theo mục (cần chủ sở hữu duyệt). Khiếu nại phải đi theo toggle "Hợp đồng", gate theo eventType (và audience PARTY) chứ không theo category.

**Thiếu thông báo (nên thêm kèm email, thêm consumer trước producer)**
1. Hạn cuối "thông báo vi phạm" (default notice) sắp tự hủy: scheduler bỏ qua đúng trường hợp này (`AgreementSigningReminderScheduler.java:92`), phát notice ở `RentalOnboardingService.java:653`, tự chấm dứt ở `:713`. Cần `DEFAULT_FINAL_DUE_SOON` (24h trước). Phần tự hủy thuộc module Yêu cầu thuê.
2. Sắp hết hạn phản hồi/ký phụ lục và gia hạn: chỉ có EXPIRED sau khi hết hạn (`ContractAmendmentService:361-369`, `ContractLifecycleService:424-431`): `AMENDMENT/RENEWAL_DUE_SOON`.
3. Sắp quá hạn phản hồi đề xuất hoàn cọc: chỉ có OVERDUE sau (`ContractLifecycleService:451-455`): `SETTLEMENT_RESPONSE_DUE_SOON`; bên trễ chịu thiệt.
4. Hợp đồng sắp hết hạn: chỉ có WINDOW_OPENED một lần (`:441-444`); thiếu nhắc T-30/T-7 ngày trước ngày kết thúc.
5. Quá hạn trả nhà sau LEASE_EXPIRED (`:436` tạo WAITING_HANDOVER) không có nhắc nếu không ai xác nhận.
6. Khách xem xét quyết định đơn phương sắp hết hạn (`terminationReviewHours`, `MonthlyBillingSchedule.java:27`): thiếu nhắc.
7. Hạn bổ sung của COMPLAINT_INFO_REQUESTED sắp tới: thiếu nhắc.
8. Người dùng không biết bằng chứng blockchain của hợp đồng đã ký bị lỗi (chỉ admin nhận SYSTEM_INCIDENT; `ContractDocumentIntegrityService` chỉ báo khi mở file): thấp, chỉ cần khi tải PDF/đính kèm bị `MISMATCH` (xem mục 3).
9. Nhắc CH ký cọc: `findIdsAwaitingLandlordLeaseSignatureDue` chỉ gồm HĐ thuê gốc (giả định, chưa kiểm tra truy vấn), nên lượt CH ký cọc chỉ có REVIEW_READY (nay đề xuất email).
(Ngoài module: nhắc tự xác nhận nhận tiền thuộc PAYMENT; kết thúc cọc do vi phạm `DepositAgreementService.java:79,85,110` chỉ ghi audit, người dùng nhận thông báo qua RENTAL_* của module Yêu cầu thuê.)

## 5. Việc cần làm theo repo (theo thứ tự)
**hs-core-api**: (1) endpoint nội bộ `/internal/contracts/agreements/{id}/signed-pdf` + `contentForSystem` + test (user ngoài hợp đồng bị chặn, MISMATCH không trả bytes, không có `SIGNED_FINAL` trả 404); (2) endpoint nội bộ tóm tắt `{loại, số HĐ, vai trò, tên tin, hạn}` có kiểm tra userId thuộc hợp đồng (KHÔNG đổi envelope Kafka: consumer từ chối thuộc tính lạ, `NE:640-660`); (3) event mới cho khoảng trống 1-7 (id xác định theo đối tượng, người, hạn); (4) xóa hoặc xác nhận không còn tham chiếu 3 event CONTRACT_* chết.
**hs-notification-service**: (1) tách `EmailDeliveryService.process` khỏi `renderSystemBroadcastEmail`: registry eventType -> hàm render trong `templates/contract/{index.ts,*.hbs}` + `email.spec.ts`; (2) `EmailJob` lưu `eventType`, key `ct:<sourceEventId>:<recipientId>`, allowlist event thay gate SYSTEM-only; (3) `attachments` trong `EmailProvider` + client gọi endpoint PDF + retry/`attachmentState` + test (trùng, opt-out, Core lỗi, MISMATCH, quá cỡ); (4) `UserEmailDirectory` thêm tóm tắt an toàn; (5) preference mặc định + reset; (6) xóa 3 event chết khỏi `NE:171-188` và spec; (7) cập nhật README và `EMAIL_RESEND.md`. Mở FULLY_SIGNED trước (một event), rồi các event "Có" còn lại, digest sau cùng.
**hs-web**: bật công tắc Email mục Hợp đồng (đang "Sắp có"), hiển thị cho người dùng rằng email có đính kèm hợp đồng.
**Rủi ro**: event mới phải deploy consumer trước producer (nếu không vào DLT); Resend 2 req/s và hạn mức gói (burst FULLY_SIGNED cuối tháng, mỗi mail có PDF nặng, cần giãn 500ms); email có thể đến trước khi người dùng thấy in-app nên giữ văn phong "ghi nhận", không khẳng định "đã thanh toán"; mail gửi sai địa chỉ = lộ PDF hợp đồng (chỉ dùng email đã xác minh, user active).
