# Checklist thông báo yêu cầu thuê nhà

Cập nhật 13/11/2026. Trạng thái: **đã triển khai và nghiệm thu bằng focused unit/integration tests; browser/FCM thật chưa kiểm**. `[x]` chỉ đánh dấu bằng chứng đã có; đọc test/compile không được coi là đã chạy test. Risk L3: identity/ownership, transaction, concurrency và contract Kafka.

## 1. Phân công và phạm vi

- [x] Claude Sonnet 5.5 high rà RentalRequestService, repository, scheduler và controller: tạo/duyệt/từ chối/hủy/hết hạn, cạnh tranh cùng tin.
- [x] Claude Sonnet 5.5 high rà onboarding/cancellation/refund/default/resume và các caller từ payment/contract.
- [x] Claude Sonnet 5.5 high rà notification category/parser/preferences và web route/modal/realtime.
- [x] Codex đối chiếu nguồn, chốt contract và ma trận dưới đây, giao 3 worker triển khai độc lập theo repo.
- [x] Claude hoàn tất Core producer và outbox.
- [x] Claude hoàn tất consumer/category/preferences; Codex kiểm thử schema, render, dedup, isolation và preferences.
- [x] Claude hoàn tất web deep-link, phân loại và refresh; Codex đã nghiệm thu focused logic tests.
- [x] Codex review source, viết/chạy focused regression, đối chiếu Java → Node và kiểm thử các integration boundary cần thiết.
- [x] Chốt kết quả test thực tế, rollout và các giới hạn còn lại.

Repo thay đổi dự kiến: `hs-core-api` (listing/contract và một điểm hold extension trong payment), `hs-notification-service`, `hs-web-app`. Không thêm admin notification trong đợt này; không sửa infra/topic/Gateway hoặc Firebase payload. Core sở hữu request và các bên; notification chỉ sở hữu feed/delivery. Giữ module dependency listing ← payment ← contract, không đọc database của service khác.

## 2. Quy tắc gửi

- Người nhận lấy từ `RentalRequest.ownerId/renterId` đã lưu, không lấy từ request body hoặc chủ tin hiện tại. Bên thao tác nhận toast hiện có; notification gửi cho bên đối diện. Hệ thống có thể báo cả hai bằng hai envelope theo `recipientSide`.
- Mỗi chuyển đổi/decision hợp lệ phát event mới; retry cùng outbox row giữ nguyên UUID/payload. Không có notification thành công cho denied, stale/no-op hoặc transaction rollback.
- Notification là lịch sử. Khi mở phải lấy trạng thái/quyền hiện tại từ API; không xem event cũ là quyền thực hiện action.
- Không nhầm chờ hoàn tiền với đã hủy hoặc đã nhận tiền. TRANSFER_REPORTED không phải CONFIRMED; chỉ actual final cancellation phát thông báo đã hủy.

## 3. Ma trận 26 event đã chốt

Các tên dưới đây có tiền tố đầy đủ trong code; category chung `RENTAL_REQUEST`/“Yêu cầu thuê”, priority `NORMAL`.

| Trigger thực tế | Event | Người nhận |
|---|---|---|
| Khách gửi yêu cầu thành công | `RENTAL_REQUEST_SUBMITTED` | Chủ nhà |
| Chủ nhà chấp nhận | `RENTAL_REQUEST_ACCEPTED` | Người thuê được chọn |
| Chủ nhà từ chối trực tiếp | `RENTAL_REQUEST_REJECTED` | Người thuê |
| Chấp nhận một yêu cầu làm các PENDING khác bị từ chối | `RENTAL_REQUEST_AUTO_REJECTED` | Từng người thuê thực sự bị ảnh hưởng; không báo request đã hủy/hết hạn trước đó |
| Hủy chưa chuyển tiền, hoặc actual cancellation không cần/chờ đủ hoàn tiền | `RENTAL_REQUEST_CANCELLED` | Bên đối diện actor; tenant xác nhận đủ tiền hoàn → chủ nhà |
| Hết hạn phản hồi PENDING | `RENTAL_REQUEST_EXPIRED` | Hai bên |
| ACCEPTED hết hạn giữ chỗ thực sự, không thuộc hold được bảo vệ | `RENTAL_HOLD_EXPIRED` | Hai bên |
| Đề nghị hủy legacy hoặc workflow | `RENTAL_CANCELLATION_REQUESTED` | Bên cần quyết định |
| Đã đồng ý hủy nhưng còn cần hoàn tiền, request vẫn ACCEPTED | `RENTAL_CANCELLATION_REFUND_PENDING` | Bên đối diện actor; không gọi là đã hủy/đã hoàn tiền |
| Từ chối đề nghị hủy | `RENTAL_CANCELLATION_REJECTED` | Bên đề nghị |
| Rút đề nghị hủy | `RENTAL_CANCELLATION_WITHDRAWN` | Bên còn lại |
| Escalate cancellation workflow thành tranh chấp | `RENTAL_CANCELLATION_DISPUTED` | Bên còn lại; chưa thêm complaint/admin feed |
| Đề nghị vào ở sớm | `RENTAL_START_CHANGE_REQUESTED` | Chủ nhà |
| Duyệt ngày vào ở sớm | `RENTAL_START_CHANGE_APPROVED` | Người thuê |
| Từ chối ngày vào ở sớm | `RENTAL_START_CHANGE_REJECTED` | Người thuê |
| Rút đề nghị vào ở sớm | `RENTAL_START_CHANGE_WITHDRAWN` | Chủ nhà |
| Đề nghị đổi ngày thực sự hết hạn khi sync | `RENTAL_START_CHANGE_EXPIRED` | Hai bên, actor SYSTEM dù sync do HTTP gọi |
| Chủ nhà mở lại cửa sổ ký trước thuê | `RENTAL_SIGNING_WINDOW_REOPENED` | Người thuê |
| Gia hạn hold qua review hoặc dispute/reopen | `RENTAL_HOLD_EXTENDED` | Người thuê nếu owner làm; hai bên nếu admin/system; chỉ khi deadline thực sự thay đổi |
| Phát cảnh báo quá hạn giữ phòng/hoàn tất hồ sơ trước thuê | `RENTAL_DEFAULT_NOTICE_ISSUED` | Người thuê; hệ thống phát thì cả hai |
| Người thuê phản đối cảnh báo default lần đầu | `RENTAL_DEFAULT_DISPUTED` | Chủ nhà; lặp cùng cảnh báo không spam |
| Chốt default và hủy giữ phòng thực sự | `RENTAL_REQUEST_CANCELLED_BY_SYSTEM` | Người thuê; scheduler làm thì cả hai |
| Đề nghị tiếp tục sau giải quyết tranh chấp | `RENTAL_RESUME_REQUESTED` | Bên cần quyết định |
| Đồng ý tiếp tục hồ sơ trước thuê | `RENTAL_RESUMED` | Bên còn lại; không khẳng định đã ký/kích hoạt hợp đồng |
| Từ chối tiếp tục | `RENTAL_RESUME_REJECTED` | Bên đề nghị |
| Rút đề nghị tiếp tục | `RENTAL_RESUME_WITHDRAWN` | Bên còn lại |

## 4. Điểm dễ bỏ sót và invariant cần nghiệm thu

- [x] Rà active cancellation endpoint: `RentalRequestController.cancel` gọi `RentalOnboardingService.cancelUnpaid`; chỉ gắn vào legacy `RentalRequestService.cancelRentalRequest` sẽ bỏ sót production.
- [x] Rà contender bulk rejection: bulk UPDATE chỉ trả count; cần capture exact locked PENDING set trong cùng transaction, không SELECT không khóa rồi thông báo nhầm cho request bị hủy/hết hạn đồng thời.
- [x] Rà actual cancellation chung sau đủ refund confirmation: synchronous listener phải cùng transaction, không AFTER_COMMIT/REQUIRES_NEW và không phát khi mới report/partial receipt.
- [x] Rà requestEarlier sync được gọi từ nhiều nơi; chỉ transition REQUESTED→EXPIRED mới phát, không dùng actor của caller làm actor quyết định hệ thống.
- [x] Rà default notice fingerprint/complete retry guard; disputeDefault cần guard lần đầu để không spam khi gọi lặp.
- [x] Codex đọc `view()`: terminal rental status được ưu tiên trước pending cancellation flags. Giữ nghiệp vụ cancelUnpaid hiện có; terminal event supersedes action cũ khi UI tải lại, không thêm guard thay đổi quyền hủy chỉ vì notification.
- [x] PostgreSQL kiểm chứng rollback acceptance/contender/outbox khi payment hoặc parking thất bại; workflow refund confirmation/state/outbox cùng rollback khi release thất bại; start-change date/decision/parking/outbox cùng rollback. Race accept/accept, accept/cancel, expiry/cancel, concurrent refund retry đã qua. Không coi mock payment/parking là tích hợp toàn bộ hệ thống ngoài DB.
- [x] PostgreSQL kiểm chứng publisher per-request FIFO/SKIP LOCKED/ack/retry cùng payload, kể cả ACK xong DB update thất bại; dùng đúng rental_request_id. KafkaTemplate được mock để điều khiển ACK/failure; Kafka thật được kiểm riêng phía consumer smoke.
- [x] Kiểm chứng focused web logic: rental sync không kích hoạt unread-title fetch, burst coalesce, shared POST, không reset form khi refresh silent. Chưa thay thế đo performance bằng browser thật.

## 5. Contract Kafka và rollout

- Envelope v1 giữ nguyên: `eventId,eventType,version,occurredAt,recipients,data`; timestamp UTC đúng 3 chữ số millisecond.
- Mọi event rental có `data` đúng allowlist: `requestId`, `recipientSide` bắt buộc (`OWNER|RENTER`), `listingTitle` tùy chọn plain text tối đa 120 ký tự. Không có field khác: reason/note/names/address/phone/money/status/deadline/changeId/URL bị loại.
- Metadata đúng `{requestId,recipientSide}`. Body tiếng Việt cố định theo type, có thể thêm title; người nhận mở hồ sơ để đọc deadline và thông tin riêng tư hiện tại. Push vẫn generic.
- Route do consumer dựng: chủ nhà `/dashboard/rental-requests?requestId=<id>`, người thuê `/dashboard/rental-requests/my-requests?requestId=<id>`.
- Consumer/category mới phải chạy trước web mới và Core producer. Consumer cũ sẽ DLT type mới rồi commit offset; không tự replay sau nâng cấp.
- Thêm category ở tuple backend (DTO/schema theo tuple) và web meta/tab/icons/settings. Preferences đã lưu thiếu category mới mặc định bật theo hành vi hiện có; không cần migration/xóa dữ liệu. Web cũ lưu toàn bộ preferences có thể reset tùy chọn category mới về default.
- Outbox mới `rental_request_notification_outbox` keyed `rental_request_id`, cấu hình `notification.*` hiện có. DDL bên dưới; chưa áp dụng vào database nghiệp vụ.

DDL bổ sung, không xóa/chuyển dữ liệu hiện tại. Với môi trường dùng Hibernate `ddl-auto=update`, entity tạo bảng khi Core khởi động; môi trường quản lý migration cần áp dụng tương đương trước khi bật publisher:

```sql
CREATE TABLE IF NOT EXISTS rental_request_notification_outbox (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_id VARCHAR(36) NOT NULL UNIQUE,
  rental_request_id VARCHAR(36) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_rental_request_outbox_pending
  ON rental_request_notification_outbox (sent_at, id);
CREATE INDEX IF NOT EXISTS idx_rental_request_outbox_request
  ON rental_request_notification_outbox (rental_request_id, id);
```

Publisher chỉ đánh dấu `sent_at` sau Kafka ACK. Khi ACK/transaction commit không chắc chắn có thể phát lại cùng eventId; consumer dedup. Không hứa exactly-once hoặc tự dọn outbox. Không cần topic mới.

## 6. Điều hướng và refresh web cần làm

- [x] Thêm nhóm “Yêu cầu thuê”, subtype badge, side label; giữ booking/listing cũ.
- [x] Deep-link lấy API theo ID, không scan list hoặc phụ thuộc status tab (hiện không có tab cho mọi cancelled status).
- [x] Kiểm tra ownerId/renterId theo page side và verified userId trước owner/renter UI; anonymous login giữ query/hash, không gọi list/conflict/detail API nặc danh.
- [x] Hook tests: mở A rồi B cùng route, bỏ kết quả cũ, đóng bỏ requestId nhưng giữ query/hash, bấm lại cùng ID vẫn mở. Đã đọc mọi caller closeDetail; browser back/forward thật chưa test.
- [x] Realtime/generic push/focus/reconnect tạo tín hiệu rental-request-changed; exclude tín hiệu này khỏi listener unread-count/title.
- [x] List/detail/onboarding refresh có coalesce và cleanup; hidden tab chỉ dirty, visible recovery. Không reset input/date/reason đang nhập. Onboarding POST chia sẻ promise đang chạy. Foreground/silent có generation để kết quả cũ không ghi đè kết quả mới; spinner foreground vẫn được clear.

## 7. Chủ động để phần sau, không bỏ sót âm thầm

- `RentalRequest.COMPLETED` do hai đường ký thật (`ContractServiceImpl` và SmartCA): tích hợp trong đợt hợp đồng, không tạo thông báo giả hoàn tất trước khi ký.
- Payment-only transfer/report/confirm/refund-reported, khoản tháng đầu tới hạn, nhắc quá hạn chỉ suy từ đồng hồ mà chưa có persisted transition: dành đợt payment/contract; không thêm scheduler/reminder mới ở đây.
- Complaint/admin notification/document-signature/blockchain lifecycle: dành đúng module sau. Đợt này vẫn báo quyết định dispute/resume của hồ sơ trước thuê.
- Lock order/deadlock exposure cũ ở batch expiry cần ghi theo bằng chứng test; không hứa exactly-once. Outbox là at-least-once, consumer dedup theo recipientId+eventId.

## 8. Kết quả verification

| Phần | Kết quả |
|---|---|
| Audit 3 worker + Codex đối chiếu | Đã đọc source, chưa chạy test |
| Core focused unit | 185/185, 0 skip: listing 45 (writer 6 + service 36 + furnishing 3), payment dispute 37, onboarding/default 103 (41 + 62). Codex đọc Surefire XML xác nhận counts/zero failures/zero skips. Payment 37 qua trong reactor từng thất bại ở test fixture contract, không gọi toàn bộ lượt đó là build xanh; contract rerun riêng đã xanh. |
| Core PostgreSQL | DB riêng `core_rental_notification_test_834da1f4471d`: approval 10/10; outbox 6/6; 14 workflow ca chọn lọc qua; onboarding full 18 có 17 qua + 1 lỗi do test mới chọn nhầm change khi clock frozen, đã sửa và chạy lại đúng 4 test mới/sửa: 4/4 qua. Không chạy lại toàn class sau fix. Codex bổ sung accept-vs-response-expiry và zero-value confirmed receipt immediate cancellation: 2/2 qua, BUILD SUCCESS, 0 skip. |
| Notification schema/preferences/realtime | 116/116 qua: `npm test -- --runInBand src/modules/notification-events/rental-request-notification.spec.ts src/modules/notification/application/notification.service.spec.ts src/modules/notification/presentation/notification.controller.spec.ts`. Booking/listing consumer regression thêm 80/80 qua (`notification-events.spec.ts`, `listing-notification.spec.ts`). |
| Java fixture → Node parser/render | 52 envelope do Java writer thật sinh (26 type × 2 side) được parser và renderer Node đã build chấp nhận, đúng category/metadata/path. Writer test 6/6 qua. |
| Web logic/deep-link/refresh | 12 regression mới đã qua qua các lượt focused trong `tests/rental-request-notification.test.mjs`: type/side tags, login full URL, wrong-side/403/404/stale-response, hidden/debounce/queued refresh, popup/title không loop, onboarding shared POST và giữ ngày/lý do đang nhập, foreground/silent race list và detail, chặn API trước auth. Regression booking/listing/rental-actions cũ 23/23 qua. Worker `npx tsc --noEmit` + scoped eslint source qua; scoped eslint test qua sau sửa tên biến `module` bị Next lint cấm. |
| Kafka → MongoDB → REST | `npm run build` và `npm run test:backend` qua: 26 rental type × 2 side × duplicate replay, persistence/dedup/isolation/routes/preferences; booking/listing cũ vẫn qua. Chỉ DB `homespace_notification_test`, Kafka topic ngẫu nhiên `homespace.notification.test.*`, push/socket tắt trong smoke. Không đụng data nghiệp vụ. |
| Browser hai tài khoản và Chrome push thật | Chưa chạy |

Codex đã đối chiếu báo cáo worker, Surefire và chạy thêm acceptance tests trực tiếp. Counts ở trên là phạm vi thực sự chạy; không tuyên bố toàn bộ platform test suite hoặc browser E2E đã qua.

### Lệnh Core đã chạy và phạm vi còn lại

Các lệnh dưới từ `hs-core-api`; dùng wrapper, không `clean`. Trong PowerShell phải quote nguyên đối số `-D...` có dấu chấm. Mọi lượt PostgreSQL nạp credentials từ môi trường, assert đúng DB test ở trên; không in credentials. `RentalWorkflowPostgresTest` cho phép DB disposable cũ `hs_workflow_test` hoặc prefix DB riêng mới; lượt cuối Codex xóa biến `HS_WORKFLOW_TEST_PG_URL` trong process test để buộc dùng DB riêng.

```text
./mvnw -o -pl hs-listing-service -am -Dtest=RentalRequestNotificationWriterTest,RentalRequestServiceTest,ListingFurnishingMappingTest -Dsurefire.failIfNoSpecifiedTests=false test
./mvnw -o -pl hs-contract-service -am -Dtest=PaymentDisputeServiceTest,RentalOnboardingServiceTest,RentalDefaultTest -Dsurefire.failIfNoSpecifiedTests=false test
./mvnw -o -pl hs-contract-service -am -Dtest=RentalOnboardingServiceTest,RentalDefaultTest -Dsurefire.failIfNoSpecifiedTests=false test
./mvnw.cmd -o -pl hs-listing-service -am "-Dtest=RentalRequestApprovalPostgresTest" "-Dsurefire.failIfNoSpecifiedTests=false" test
./mvnw.cmd -o -pl hs-listing-service -am "-Dtest=RentalRequestNotificationPostgresTest" "-Dsurefire.failIfNoSpecifiedTests=false" test
./mvnw.cmd -o -pl hs-contract-service -am "-Dtest=OnboardingPersistencePostgresTest#startChangeRejectAndWithdrawPersistExactSideSpecificNotices+expiredStartChangeNotifiesBothPartiesOnceAsSystemEvenWhenARenterRefreshesIt+earlierStartPersistsCalendarAndAuditWithoutChangingPrice+failedCapacityDecisionRollsBackBothDateAndDecision" "-Dsurefire.failIfNoSpecifiedTests=false" test
./mvnw -o -q -pl hs-api-service -am test-compile
mvn -pl hs-contract-service -am "-Dtest=RentalRequestApprovalPostgresTest#overdueRequestCannotBeAcceptedWhileResponseExpiryIsRunning,RentalWorkflowPostgresTest#zeroValueConfirmedReceiptCancelsImmediatelyWithoutARefundPendingNotice" "-Dsurefire.failIfNoSpecifiedTests=false" test
```

Workflow 14 ca: propose/accept/refund receipt (1 pending rồi 1 final cancel), rollback khi release thất bại, withdraw/reject/escalate, denied/stale action, bốn resume decisions, invalid resume, parallel approval/receipt retry, legacy no-deposit-document refund completion và replay không release lần hai. Chỉ các ca này được chạy, không toàn class workflow. API chỉ test-compile, không phải HTTP integration pass.

Đã sửa wiring/compile, chưa chạy các suite dùng DB guard khác: `PaymentDisputePostgresTest`, `ContractLifecyclePhase03PostgresTest`, `ComplaintCasePostgresTest`, `RentalWorkflowHttpSystemTest`. Admin-route HOLD_EXTENDED đã kiểm unit, chưa kiểm PostgreSQL riêng. Legacy cancel method đã có unit và PostgreSQL; active HTTP cancel endpoint chưa có HTTP E2E, service `cancelUnpaid` đã kiểm unit cho owner/renter/no-op/denied. Chưa chạy app/browser hai tài khoản hay Firebase thật. Không thay đổi notification payload riêng tư hoặc quyền Gateway/socket.

## 9. Thử thủ công và thứ tự cập nhật

1. Cập nhật/restart notification-service trước, web tiếp theo, Core cuối. Bảng outbox mới phải tồn tại (dev `ddl-auto=update` hoặc áp DDL mục 5). Không cần thêm biến môi trường, topic hoặc Firebase key cho module này; dùng cấu hình notification/socket/push hiện có.
2. Chủ nhà dùng một phiên Chrome, người thuê dùng phiên/profile khác. Tạo yêu cầu thuê: chủ nhà nhận popup dưới trái, count tăng và feed có nhóm “Yêu cầu thuê”; bấm mở đúng modal, kể cả khi yêu cầu ngoài trang/filter hiện tại.
3. Chủ nhà chấp nhận/từ chối: người thuê nhận đúng subtype. Nếu chấp nhận một request, những người thuê bị auto-reject nhận loại riêng. Người thao tác vẫn nhận toast thao tác cũ, không nhận notification tự gửi.
4. Thử đổi ngày bắt đầu, rút/từ chối/chấp thuận; hủy chưa trả tiền; hủy cần hoàn tiền: phân biệt “chờ hoàn tiền” với “đã hủy”. Report refund chưa được coi là đã nhận; chỉ đủ confirmed receipt mới kết thúc. Mở sẵn form nhập ngày/lý do rồi nhận realtime: nội dung chưa gửi phải được giữ.
5. Đóng modal và bấm lại cùng notification; đổi tài khoản hoặc dùng link của bên khác phải bị chặn theo quyền hiện tại. Chuyển tab/ẩn tab rồi quay lại phải cập nhật dữ liệu và không tạo vòng lặp title/count.
6. Muốn kiểm Chrome push thật: dùng client Chrome thường đã đăng ký thiết bị, đóng tab HomeSpace nhưng giữ Chrome chạy rồi thao tác từ phiên bên kia. Push vẫn generic. Phiên ẩn danh phù hợp để tách account thao tác; không dùng làm bằng chứng push nền.

Lỗi được phát hiện khi nghiệm thu: Java regex escape writer đã sửa trước khi tests chạy; hook refresh ban đầu chỉ kiểm tra hidden lúc enqueue, đã sửa kiểm tra lại trước mỗi API call và có regression; smoke script mới đặt block rental sai vị trí biến/expectation, Codex đã chuyển về cuối trước khi smoke qua. Lint spec mới sạch; script smoke còn một warning có sẵn ở helper fetch (`body` với method có thể là GET), không có lỗi lint. Build notification qua; full test-typecheck còn lỗi fixture admin-broadcast cũ, không dùng kết quả đó để tuyên bố toàn repo sạch.
