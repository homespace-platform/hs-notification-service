import type {
  NewNotification,
  NotificationCategory,
} from '../notification/domain/notification.model';

// Neutral copy: every type can reach either side; producer sends no reason/date/amount.
const rental = (title: string, body: string) =>
  ['RENTAL_REQUEST', title, body, 'requestId'] as const;

const templates = {
  RENTAL_REQUEST_SUBMITTED: rental('Yêu cầu thuê đã được gửi', 'Một yêu cầu thuê đã được gửi.'),
  RENTAL_REQUEST_ACCEPTED: rental('Yêu cầu thuê đã được chấp nhận', 'Yêu cầu thuê đã được chấp nhận. Vui lòng mở yêu cầu để xem bước tiếp theo.'),
  RENTAL_REQUEST_REJECTED: rental('Yêu cầu thuê bị từ chối', 'Yêu cầu thuê đã bị từ chối.'),
  RENTAL_REQUEST_AUTO_REJECTED: rental('Yêu cầu thuê không được chọn', 'Yêu cầu thuê đã bị từ chối tự động vì một yêu cầu thuê khác đã được chọn.'),
  RENTAL_REQUEST_CANCELLED: rental('Yêu cầu thuê đã bị hủy', 'Yêu cầu thuê đã bị hủy.'),
  RENTAL_REQUEST_EXPIRED: rental('Yêu cầu thuê hết hạn phản hồi', 'Yêu cầu thuê đã hết hạn vì không được phản hồi kịp thời.'),
  RENTAL_HOLD_EXPIRED: rental('Thời gian giữ chỗ đã hết', 'Thời gian giữ chỗ cho yêu cầu thuê đã hết hạn.'),
  RENTAL_CANCELLATION_REQUESTED: rental('Có yêu cầu hủy thuê', 'Một yêu cầu hủy thuê đã được gửi. Vui lòng mở yêu cầu để xem chi tiết.'),
  RENTAL_CANCELLATION_REFUND_PENDING: rental('Hủy thuê đang chờ hoàn tiền', 'Yêu cầu hủy thuê đang chờ xử lý hoàn tiền. Việc hủy thuê và hoàn tiền chưa hoàn tất.'),
  RENTAL_CANCELLATION_REJECTED: rental('Yêu cầu hủy thuê bị từ chối', 'Yêu cầu hủy thuê đã bị từ chối.'),
  RENTAL_CANCELLATION_WITHDRAWN: rental('Yêu cầu hủy thuê đã được rút lại', 'Yêu cầu hủy thuê đã được rút lại.'),
  RENTAL_CANCELLATION_DISPUTED: rental('Yêu cầu hủy thuê bị phản đối', 'Yêu cầu hủy thuê đã bị phản đối. Đây chưa phải kết quả giải quyết khiếu nại.'),
  RENTAL_START_CHANGE_REQUESTED: rental('Có yêu cầu đổi ngày bắt đầu thuê', 'Một yêu cầu đổi ngày bắt đầu thuê đã được gửi. Vui lòng mở yêu cầu để xem chi tiết.'),
  RENTAL_START_CHANGE_APPROVED: rental('Đổi ngày bắt đầu thuê được chấp nhận', 'Yêu cầu đổi ngày bắt đầu thuê đã được chấp nhận.'),
  RENTAL_START_CHANGE_REJECTED: rental('Đổi ngày bắt đầu thuê bị từ chối', 'Yêu cầu đổi ngày bắt đầu thuê đã bị từ chối.'),
  RENTAL_START_CHANGE_WITHDRAWN: rental('Yêu cầu đổi ngày bắt đầu thuê đã được rút lại', 'Yêu cầu đổi ngày bắt đầu thuê đã được rút lại.'),
  RENTAL_START_CHANGE_EXPIRED: rental('Yêu cầu đổi ngày bắt đầu thuê đã hết hạn', 'Yêu cầu đổi ngày bắt đầu thuê đã hết hạn.'),
  RENTAL_SIGNING_WINDOW_REOPENED: rental('Thời gian ký hợp đồng được mở lại', 'Thời gian ký hợp đồng đã được mở lại. Hợp đồng chưa được ký.'),
  RENTAL_HOLD_EXTENDED: rental('Thời gian giữ chỗ được gia hạn', 'Thời gian giữ chỗ cho yêu cầu thuê đã được gia hạn.'),
  RENTAL_DEFAULT_NOTICE_ISSUED: rental('Có thông báo về yêu cầu thuê', 'Một thông báo liên quan đến yêu cầu thuê đã được phát hành. Vui lòng mở yêu cầu để xem hạn xử lý hiện tại.'),
  RENTAL_DEFAULT_DISPUTED: rental('Thông báo về yêu cầu thuê bị phản đối', 'Thông báo liên quan đến yêu cầu thuê đã bị phản đối. Vui lòng mở yêu cầu để xem hạn xử lý hiện tại.'),
  RENTAL_REQUEST_CANCELLED_BY_SYSTEM: rental('Yêu cầu thuê bị hủy bởi hệ thống', 'Yêu cầu thuê đã bị hệ thống hủy.'),
  RENTAL_RESUME_REQUESTED: rental('Có yêu cầu tiếp tục thuê', 'Một yêu cầu tiếp tục yêu cầu thuê đã được gửi. Vui lòng mở yêu cầu để xem chi tiết.'),
  RENTAL_RESUMED: rental('Yêu cầu thuê đã được tiếp tục', 'Yêu cầu thuê đã được tiếp tục. Hợp đồng chưa được ký.'),
  RENTAL_RESUME_REJECTED: rental('Yêu cầu tiếp tục thuê bị từ chối', 'Yêu cầu tiếp tục yêu cầu thuê đã bị từ chối.'),
  RENTAL_RESUME_WITHDRAWN: rental('Yêu cầu tiếp tục thuê đã được rút lại', 'Yêu cầu tiếp tục yêu cầu thuê đã được rút lại.'),
  LISTING_APPROVED: [
    'LISTING',
    'Tin đăng đã được duyệt',
    'Tin đăng của bạn đã được duyệt.',
    'listingId',
  ],
  LISTING_REJECTED: [
    'LISTING',
    'Tin đăng chưa được duyệt',
    'Tin đăng của bạn cần được chỉnh sửa.',
    'listingId',
  ],
  LISTING_CREATED: [
    'LISTING',
    'Tin đăng đã được tạo',
    'Một tin đăng mới đã được tạo cho bạn.',
    'listingId',
  ],
  LISTING_UPDATED: [
    'LISTING',
    'Tin đăng đã được cập nhật',
    'Nội dung tin đăng của bạn đã được cập nhật.',
    'listingId',
  ],
  LISTING_EDIT_APPROVED: [
    'LISTING',
    'Chỉnh sửa tin đăng đã được duyệt',
    'Yêu cầu chỉnh sửa tin đăng của bạn đã được duyệt.',
    'listingId',
  ],
  LISTING_EDIT_REJECTED: [
    'LISTING',
    'Chỉnh sửa tin đăng chưa được duyệt',
    'Yêu cầu chỉnh sửa tin đăng của bạn chưa được duyệt. Vui lòng mở tin đăng để xem chi tiết.',
    'listingId',
  ],
  LISTING_STATUS_CHANGED: [
    'LISTING',
    'Trạng thái tin đăng đã thay đổi',
    'Trạng thái tin đăng của bạn đã thay đổi.',
    'listingId',
  ],
  LISTING_EXPIRED: [
    'LISTING',
    'Thời hạn đăng tin đã kết thúc',
    'Thời hạn đăng tin của bạn đã kết thúc, kể cả khi tin đang có chỉnh sửa chờ duyệt.',
    'listingId',
  ],
  BOOKING_REQUESTED: [
    'APPOINTMENT',
    'Yêu cầu đặt lịch mới',
    'Bạn có một yêu cầu đặt lịch mới.',
    'bookingId',
  ],
  BOOKING_CONFIRMED: [
    'APPOINTMENT',
    'Lịch hẹn đã được xác nhận',
    'Lịch hẹn của bạn đã được xác nhận.',
    'bookingId',
  ],
  BOOKING_CANCELLED: [
    'APPOINTMENT',
    'Lịch hẹn đã bị hủy',
    'Lịch hẹn của bạn đã bị hủy.',
    'bookingId',
  ],
  BOOKING_REJECTED: [
    'APPOINTMENT',
    'Yêu cầu đặt lịch bị từ chối',
    'Chủ nhà đã từ chối yêu cầu đặt lịch xem nhà của bạn.',
    'bookingId',
  ],
  BOOKING_RESCHEDULE_REQUESTED: [
    'APPOINTMENT',
    'Yêu cầu đổi lịch xem nhà',
    'Khách hàng đã gửi yêu cầu thay đổi thời gian xem nhà.',
    'bookingId',
  ],
  BOOKING_RESCHEDULE_APPROVED: [
    'APPOINTMENT',
    'Yêu cầu đổi lịch được chấp nhận',
    'Chủ nhà đã chấp nhận thời gian xem nhà mới của bạn.',
    'bookingId',
  ],
  BOOKING_RESCHEDULE_REJECTED: [
    'APPOINTMENT',
    'Yêu cầu đổi lịch bị từ chối',
    'Chủ nhà đã từ chối yêu cầu đổi lịch. Thời gian hẹn trước đó được giữ nguyên.',
    'bookingId',
  ],
  BOOKING_COMPLETED: [
    'APPOINTMENT',
    'Lịch xem nhà đã hoàn tất',
    'Lịch hẹn xem nhà đã được đánh dấu hoàn tất.',
    'bookingId',
  ],
  BOOKING_EXPIRED: [
    'APPOINTMENT',
    'Yêu cầu đặt lịch đã hết hạn',
    'Yêu cầu đặt lịch xem nhà đã hết hạn trước khi được xác nhận.',
    'bookingId',
  ],
  CONTRACT_AWAITING_SIGNATURE: [
    'CONTRACT',
    'Hợp đồng cần ký',
    'Hợp đồng của bạn đang chờ ký.',
    'contractId',
  ],
  CONTRACT_SIGNED: [
    'CONTRACT',
    'Hợp đồng đã được ký',
    'Hợp đồng của bạn đã được ký.',
    'contractId',
  ],
  CONTRACT_EXPIRED: [
    'CONTRACT',
    'Hợp đồng đã hết hạn',
    'Hợp đồng của bạn đã hết hạn.',
    'contractId',
  ],
  PAYMENT_SUCCESSFUL: [
    'PAYMENT',
    'Thanh toán thành công',
    'Khoản thanh toán của bạn đã được thực hiện thành công.',
    'paymentId',
  ],
  PAYMENT_FAILED: [
    'PAYMENT',
    'Thanh toán thất bại',
    'Không thể hoàn tất khoản thanh toán của bạn.',
    'paymentId',
  ],
  PAYMENT_OVERDUE: [
    'PAYMENT',
    'Thanh toán quá hạn',
    'Khoản thanh toán của bạn đã quá hạn.',
    'paymentId',
  ],
  // Membership orders: orderId only. REVIEW copy stays neutral because a later transaction can move PAID to REVIEW.
  MEMBERSHIP_ACTIVATED: [
    'PAYMENT',
    'Gói đăng tin đã được kích hoạt',
    'Gói đăng tin của bạn đã được kích hoạt. Vui lòng mở đơn hàng để xem chi tiết.',
    'orderId',
  ],
  MEMBERSHIP_PAYMENT_REVIEW: [
    'PAYMENT',
    'Đơn gói đăng tin cần đối soát',
    'Giao dịch của đơn gói đăng tin cần được đối soát. Vui lòng mở đơn hàng để kiểm tra trạng thái hiện tại.',
    'orderId',
  ],
  CHAT_MESSAGE_RECEIVED: [
    'CHAT',
    'Tin nhắn mới',
    'Bạn vừa nhận được một tin nhắn mới.',
    'conversationId',
  ],
} as const;

// Account events carry no data: generic copy, no role/reason/actor, no delivery promise.
const accountTemplates = {
  ACCOUNT_ROLE_CHANGED: [
    'Quyền truy cập tài khoản đã thay đổi',
    'Quyền truy cập tài khoản của bạn đã thay đổi. Vui lòng xem thông tin tài khoản hiện tại của bạn.',
  ],
  ACCOUNT_DISABLED: [
    'Tài khoản đã bị vô hiệu hóa',
    'Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ bộ phận hỗ trợ nếu cần trợ giúp.',
  ],
  ACCOUNT_ENABLED: [
    'Tài khoản đã được kích hoạt lại',
    'Tài khoản của bạn đã được kích hoạt lại. Bạn có thể đăng nhập để tiếp tục sử dụng.',
  ],
} as const;
const ACCOUNT_ACTION_PATH = '/settings/account-security';
const isAccountType = (value: string): value is keyof typeof accountTemplates =>
  Object.hasOwn(accountTemplates, value);

// Payment/refund events (Phase 3): data is exactly {paymentId}, one persisted party per envelope.
// Copy is neutral to payer/payee (refunds reverse direction) and carries no amount, bank, name, reason or file.
// A reported transfer, a routed dispute or a created request never implies a confirmed receipt or a payable window.
const paymentTemplates = {
  PAYMENT_REQUEST_CREATED: [
    'Có khoản thanh toán mới',
    'Một khoản thanh toán mới đã được tạo cho bạn. Vui lòng mở danh sách thanh toán để xem chi tiết và trạng thái hiện tại.',
  ],
  PAYMENT_OBLIGATION_OVERDUE: [
    'Nghĩa vụ thanh toán cần được kiểm tra',
    'Một nghĩa vụ thanh toán đã qua thời hạn. Vui lòng mở khoản thanh toán để đối soát và xem trạng thái hiện tại.',
  ],
  PAYMENT_TRANSFER_REPORTED: [
    'Có khoản chuyển tiền cần xác nhận',
    'Bên chuyển đã báo đã chuyển một khoản thanh toán. Đây chưa phải xác nhận đã nhận tiền; vui lòng kiểm tra tài khoản của bạn rồi xác nhận hoặc từ chối trong danh sách thanh toán.',
  ],
  PAYMENT_RECEIPT_CONFIRMED: [
    'Khoản thanh toán đã được xác nhận nhận tiền',
    'Bên nhận đã xác nhận đã nhận khoản thanh toán của bạn. Vui lòng mở danh sách thanh toán để xem chi tiết.',
  ],
  PAYMENT_RECEIPT_REJECTED: [
    'Bên nhận từ chối xác nhận khoản chuyển',
    'Bên nhận đã từ chối xác nhận khoản chuyển của bạn. Vui lòng mở danh sách thanh toán để xem chi tiết và bước tiếp theo.',
  ],
  PAYMENT_DISPUTE_OPENED: [
    'Khoản thanh toán có yêu cầu đối soát',
    'Một bên đã mở yêu cầu đối soát cho khoản thanh toán này. Vui lòng mở danh sách thanh toán để xem và phản hồi.',
  ],
  PAYMENT_DISPUTE_EVIDENCE_ADDED: [
    'Có chứng cứ mới trong hồ sơ đối soát',
    'Một bên đã bổ sung chứng cứ cho hồ sơ đối soát khoản thanh toán. Vui lòng mở danh sách thanh toán để xem.',
  ],
  PAYMENT_DISPUTE_PROPOSED: [
    'Có đề xuất xử lý đối soát',
    'Bên còn lại đã gửi đề xuất xử lý hồ sơ đối soát. Vui lòng mở danh sách thanh toán để xem và phản hồi.',
  ],
  PAYMENT_DISPUTE_PROPOSAL_DECLINED: [
    'Đề xuất đối soát đã bị từ chối',
    'Đề xuất xử lý hồ sơ đối soát của bạn đã bị từ chối. Vui lòng mở danh sách thanh toán để xem các bước hiện có.',
  ],
  PAYMENT_DISPUTE_ESCALATED: [
    'Hồ sơ đối soát đã chuyển quản trị viên',
    'Hồ sơ đối soát khoản thanh toán đã được chuyển cho quản trị viên xử lý. Vui lòng theo dõi trong danh sách thanh toán.',
  ],
  PAYMENT_DISPUTE_REVIEW_TRANSFER: [
    'Đối soát: kiểm tra lại khoản chuyển',
    'Hồ sơ đối soát đã đưa khoản thanh toán về bước kiểm tra chứng từ chuyển tiền. Đây chưa phải xác nhận đã nhận tiền; bên nhận cần xác nhận hoặc từ chối.',
  ],
  PAYMENT_DISPUTE_REOPENED: [
    'Đối soát: mở lại báo chuyển tiền',
    'Hồ sơ đối soát đã mở lại bước báo chuyển tiền cho khoản thanh toán. Khoản này chưa được xác nhận đã nhận; vui lòng mở danh sách thanh toán để xem hạn và bước tiếp theo.',
  ],
} as const;
const isPaymentType = (value: string): value is keyof typeof paymentTemplates =>
  Object.hasOwn(paymentTemplates, value);

// Monthly invoice events (Phase 4): data is exactly {contractId, invoiceId}, one persisted party per envelope.
// Copy is static, names no amount, date, meter, reason, note or person, and always sends the viewer to the CURRENT invoice
// (an invoice can change state after the event; a notice never promises a status, payable window or lease outcome).
const invoiceTemplates = {
  INVOICE_DRAFT_READY: [
    'Có hóa đơn tháng mới cần kiểm tra',
    'Một hóa đơn tháng mới đã được tạo. Vui lòng mở hóa đơn để kiểm tra nội dung và trạng thái hiện tại.',
  ],
  INVOICE_ISSUED: [
    'Hóa đơn tháng đã được phát hành',
    'Một hóa đơn tháng đã được phát hành cho bạn. Vui lòng mở hóa đơn để xem trạng thái hiện tại.',
  ],
  INVOICE_OVERDUE: [
    'Hóa đơn tháng đã quá hạn',
    'Một hóa đơn tháng đã quá hạn thanh toán. Vui lòng mở hóa đơn để xem các lựa chọn hiện có.',
  ],
  INVOICE_AMOUNT_UPDATED: [
    'Số tiền hóa đơn đã được cập nhật',
    'Số tiền của một hóa đơn tháng đã được cập nhật. Vui lòng mở hóa đơn để kiểm tra trước khi chuyển khoản.',
  ],
  INVOICE_EXTENSION_REQUESTED: [
    'Có yêu cầu gia hạn thanh toán hóa đơn',
    'Người thuê đã gửi yêu cầu gia hạn thanh toán cho một hóa đơn tháng. Vui lòng mở hóa đơn để xem và phản hồi.',
  ],
  INVOICE_EXTENSION_APPROVED: [
    'Hóa đơn tháng được gia hạn thanh toán',
    'Chủ nhà đã gia hạn thanh toán cho một hóa đơn tháng. Vui lòng mở hóa đơn để xem hạn thanh toán hiện tại.',
  ],
  INVOICE_EXTENSION_REJECTED: [
    'Yêu cầu gia hạn thanh toán bị từ chối',
    'Chủ nhà đã từ chối yêu cầu gia hạn thanh toán của một hóa đơn tháng. Vui lòng mở hóa đơn để xem các bước tiếp theo.',
  ],
  INVOICE_EXTENSION_EXPIRED: [
    'Yêu cầu gia hạn thanh toán đã hết hạn',
    'Yêu cầu gia hạn thanh toán của một hóa đơn tháng đã hết hạn xử lý. Vui lòng mở hóa đơn để xem trạng thái hiện tại.',
  ],
  INVOICE_OVERDUE_ACTION_RECORDED: [
    'Chủ nhà đã ghi nhận một bước xử lý',
    'Chủ nhà đã ghi nhận một bước xử lý cho hóa đơn tháng quá hạn. Vui lòng mở hóa đơn để xem chi tiết.',
  ],
  INVOICE_OVERDUE_ACTION_ACKNOWLEDGED: [
    'Đã ghi nhận phản hồi của người thuê',
    'Người thuê đã xem hoặc phản hồi bước xử lý của hóa đơn tháng quá hạn. Vui lòng mở hóa đơn để xem chi tiết.',
  ],
  INVOICE_DEFERRED: [
    'Có quyết định chuyển khoản nợ sang hóa đơn sau',
    'Đã có quyết định chuyển khoản chưa thanh toán của một hóa đơn tháng sang hóa đơn kế tiếp. Vui lòng mở hóa đơn để xem trạng thái hiện tại.',
  ],
  INVOICE_ROLLED_OVER: [
    'Khoản chưa thanh toán đã chuyển sang hóa đơn khác',
    'Khoản chưa thanh toán của một hóa đơn tháng đã được chuyển sang hóa đơn khác và yêu cầu thanh toán cũ đã được hủy. Vui lòng mở hóa đơn để kiểm tra hóa đơn hiện tại.',
  ],
  INVOICE_OVERDUE_ACTION_REQUIRED: [
    'Hóa đơn quá hạn cần chủ nhà xử lý',
    'Một hóa đơn tháng quá hạn đang chờ chủ nhà xem xét. Vui lòng mở hóa đơn để xem các lựa chọn hiện có.',
  ],
} as const;
const isInvoiceType = (value: string): value is keyof typeof invoiceTemplates =>
  Object.hasOwn(invoiceTemplates, value);

// Move-in handover events (Phase 5): data is exactly {contractId} (the root lease id), one persisted party per envelope.
// Copy is static, names no person, role, revision, amount or free text, and always sends the viewer to the CURRENT record
// (the record can change after the event; a notice never promises it is still awaiting anything).
const handoverTemplates = {
  MOVE_IN_HANDOVER_PROPOSED: [
    'Biên bản bàn giao nhận nhà đã được cập nhật',
    'Một biên bản bàn giao nhận nhà đã được lập hoặc cập nhật. Vui lòng mở biên bản để xem nội dung và trạng thái hiện tại.',
  ],
  MOVE_IN_HANDOVER_CONFIRMED: [
    'Biên bản bàn giao nhận nhà có xác nhận mới',
    'Một bên đã xác nhận biên bản bàn giao nhận nhà. Vui lòng mở biên bản để xem trạng thái hiện tại.',
  ],
  MOVE_IN_HANDOVER_COMPLETED: [
    'Biên bản bàn giao nhận nhà đã hoàn tất',
    'Hai bên đã xác nhận biên bản bàn giao nhận nhà. Vui lòng mở biên bản để xem chi tiết; đây không phải xác nhận đã nhận tiền.',
  ],
  // Phase 6A: landlord-only trigger from Core; copy must not claim a handover record or proposal already exists.
  MOVE_IN_HANDOVER_READY: [
    'Hợp đồng thuê đã ký, có thể bắt đầu bàn giao',
    'Hợp đồng thuê đã ký đã sẵn sàng. Chủ nhà có thể xem hoặc ghi nhận việc bàn giao nhận nhà. Vui lòng mở trang để xem trạng thái hiện tại.',
  ],
  MOVE_IN_HANDOVER_DISPUTED: [
    'Có báo cáo vấn đề về biên bản bàn giao',
    'Một bên đã báo vấn đề về biên bản bàn giao nhận nhà. Vui lòng mở biên bản để xem trạng thái hiện tại.',
  ],
} as const;
const isHandoverType = (value: string): value is keyof typeof handoverTemplates =>
  Object.hasOwn(handoverTemplates, value);

// Signing events (Phase 6A): data is exactly {agreementId, agreementKind}, one persisted party per envelope.
// agreementId is the exact signing-envelope id (root id only for root lease/deposit).
// Copy is static and kind-neutral: no role, date, money, reason, failure code, valid/invalid-signature assertion or
// promise that terms were applied; every notice sends the viewer to the CURRENT status.
const agreementKinds = ['LEASE', 'DEPOSIT', 'AMENDMENT', 'RENEWAL', 'MOVE_IN', 'EARLY_EXIT'];
const agreementTemplates = {
  AGREEMENT_REVIEW_READY: [
    'Có tài liệu ký cần xem xét',
    'Một tài liệu ký đã được tạo và có thể cần bạn xem xét. Vui lòng mở tài liệu để xem trạng thái hiện tại.',
  ],
  AGREEMENT_SIGNING_TURN: [
    'Bên còn lại đã hoàn tất phần của họ',
    'Bên còn lại đã hoàn tất phần của họ trong một tài liệu ký. Vui lòng mở tài liệu để xem trạng thái hiện tại và các bước hiện có.',
  ],
  AGREEMENT_FULLY_SIGNED: [
    'Tài liệu ký đã đủ chữ ký đã xác minh',
    'Các chữ ký cần thiết của một tài liệu ký đã được xác minh hoàn tất. Thông báo này không xác nhận nội dung đã được áp dụng; vui lòng mở tài liệu để xem trạng thái hiện tại.',
  ],
  AGREEMENT_SIGNATURE_NEEDS_REVIEW: [
    'Yêu cầu ký cần được kiểm tra',
    'Một yêu cầu xử lý chữ ký chưa thể hoàn tất và cần được kiểm tra. Vui lòng mở tài liệu để xem trạng thái hiện tại hoặc liên hệ bộ phận hỗ trợ nếu cần.',
  ],
} as const;
const isAgreementType = (value: string): value is keyof typeof agreementTemplates =>
  Object.hasOwn(agreementTemplates, value);

const amendmentTemplates = {
  AMENDMENT_RESPONSE_NEEDED: ['Có yêu cầu điều chỉnh hợp đồng', 'Một yêu cầu điều chỉnh hợp đồng đang chờ bạn xem xét. Vui lòng mở hồ sơ để kiểm tra nội dung và trạng thái hiện tại.'],
  AMENDMENT_DECIDED: ['Yêu cầu điều chỉnh đã được phản hồi', 'Bên còn lại đã phản hồi một yêu cầu điều chỉnh hợp đồng. Vui lòng mở hồ sơ để xem quyết định và bước tiếp theo.'],
  AMENDMENT_WITHDRAWN: ['Yêu cầu điều chỉnh đã được rút', 'Một yêu cầu điều chỉnh hợp đồng đã được rút. Vui lòng mở hồ sơ để xem trạng thái hiện tại.'],
  AMENDMENT_EXPIRED: ['Yêu cầu điều chỉnh đã hết hạn', 'Một yêu cầu điều chỉnh hợp đồng đã đóng do hết hạn. Vui lòng mở hồ sơ để xem trạng thái hiện tại.'],
  AMENDMENT_APPLIED: ['Phụ lục đã được áp dụng', 'Một phụ lục đã được áp dụng vào điều khoản hợp đồng. Vui lòng mở hồ sơ để kiểm tra; thông báo này không xác nhận bất kỳ khoản thanh toán nào.'],
} as const;
const isAmendmentType = (value: string): value is keyof typeof amendmentTemplates =>
  Object.hasOwn(amendmentTemplates, value);

const renewalTemplates = {
  RENEWAL_REQUESTED: ['Có yêu cầu gia hạn hợp đồng', 'Người thuê đã gửi yêu cầu gia hạn. Chủ nhà có thể mở hồ sơ để xem và quyết định.'],
  RENEWAL_APPROVED: ['Yêu cầu gia hạn được chấp thuận', 'Chủ nhà đã chấp thuận yêu cầu gia hạn và tạo văn bản ký. Hợp đồng chỉ được gia hạn sau khi hoàn tất các bước ký cần thiết.'],
  RENEWAL_REJECTED: ['Yêu cầu gia hạn bị từ chối', 'Chủ nhà đã từ chối yêu cầu gia hạn. Vui lòng mở hồ sơ để xem trạng thái hiện tại.'],
  RENEWAL_EXPIRED: ['Yêu cầu gia hạn đã hết hạn', 'Một yêu cầu gia hạn đã đóng do hết hạn hoặc hợp đồng không còn ở trạng thái cho phép. Vui lòng mở hồ sơ để xem chi tiết.'],
} as const;
const isRenewalType = (value: string): value is keyof typeof renewalTemplates =>
  Object.hasOwn(renewalTemplates, value);

const terminationTemplates = {
  TERMINATION_RESPONSE_NEEDED: ['Có đề nghị chấm dứt sớm', 'Bên còn lại đã gửi đề nghị chấm dứt sớm. Vui lòng mở hồ sơ để xem và phản hồi.'],
  TERMINATION_AGREED: ['Đề nghị chấm dứt đã được đồng ý', 'Bên còn lại đã đồng ý đề nghị chấm dứt sớm. Việc trả nhà và quyết toán vẫn cần hoàn tất riêng.'],
  TERMINATION_DECLINED: ['Đề nghị chấm dứt bị từ chối', 'Bên còn lại đã từ chối đề nghị chấm dứt sớm. Vui lòng mở hồ sơ để xem trạng thái hiện tại.'],
  TERMINATION_WITHDRAWN: ['Đề nghị chấm dứt đã được rút', 'Một đề nghị chấm dứt sớm đã được rút. Vui lòng mở hồ sơ để xem trạng thái hiện tại.'],
  TERMINATION_NOTICE_ISSUED: ['Có thông báo đơn phương chấm dứt', 'Chủ nhà đã gửi thông báo đơn phương chấm dứt. Vui lòng mở hồ sơ để xem thời hạn và lựa chọn hiện có.'],
  TERMINATION_REVIEW_REQUESTED: ['Có yêu cầu xem xét quyết định chấm dứt', 'Người thuê đã yêu cầu xem xét quyết định đơn phương. Vui lòng mở hồ sơ để phản hồi.'],
  TERMINATION_REVIEW_APPROVED: ['Phương án thay thế đã được chấp thuận', 'Chủ nhà đã chấp thuận phương án thay thế và rút quyết định chấm dứt. Kiểm tra hóa đơn để xem nghĩa vụ hiện tại.'],
  TERMINATION_NOTICE_CANCELLED: ['Quyết định đơn phương đã được rút', 'Quyết định đơn phương chấm dứt đã được rút. Vui lòng mở hồ sơ để xem trạng thái hiện tại.'],
  TERMINATION_ENDED: ['Hợp đồng đã chấm dứt', 'Hợp đồng đã chuyển sang trạng thái chấm dứt. Việc trả nhà, công nợ và quyết toán cần kiểm tra riêng trong hồ sơ.'],
  LEASE_EXPIRED: ['Thời hạn thuê đã kết thúc', 'Hợp đồng đã hết thời hạn thuê. Vui lòng mở hồ sơ để kiểm tra việc trả nhà và quyết toán.'],
} as const;
const isTerminationType = (value: string): value is keyof typeof terminationTemplates =>
  Object.hasOwn(terminationTemplates, value);

const returnSettlementTemplates = {
  LEASE_RETURN_CONFIRMED: ['Có xác nhận trả nhà', 'Một bên đã ghi nhận xác nhận trả nhà. Vui lòng mở hồ sơ để xem trạng thái hiện tại; việc quyết toán được theo dõi riêng.'],
  LEASE_RETURN_COMPLETED: ['Việc trả nhà đã được ghi nhận', 'Việc trả nhà đã được ghi nhận trong hồ sơ. Vui lòng kiểm tra trạng thái hiện tại; công nợ và quyết toán được xử lý riêng.'],
  SETTLEMENT_RESPONSE_NEEDED: ['Có đề xuất quyết toán cần phản hồi', 'Một đề xuất quyết toán cần bạn xem xét và phản hồi. Vui lòng mở hồ sơ để kiểm tra nội dung và trạng thái hiện tại.'],
  SETTLEMENT_DISPUTED: ['Cần đối soát đề xuất quyết toán', 'Đề xuất quyết toán chưa được thống nhất. Vui lòng mở hồ sơ để đối soát và xem các bước hiện có.'],
  SETTLEMENT_PROPOSAL_INVALIDATED: ['Đề xuất quyết toán cần được lập lại', 'Chi phí bổ sung đã làm đề xuất quyết toán trước đó không còn dùng để xác nhận. Vui lòng mở hồ sơ để đối chiếu trạng thái hiện tại.'],
  SETTLEMENT_AGREED: ['Đề xuất quyết toán đã được đồng ý', 'Người thuê đã đồng ý đề xuất quyết toán. Việc chuyển tiền và xác nhận nhận tiền được theo dõi riêng; vui lòng mở hồ sơ để xem trạng thái hiện tại.'],
  SETTLEMENT_RESPONSE_OVERDUE: ['Phản hồi quyết toán cần được kiểm tra', 'Đã qua thời hạn phản hồi của một đề xuất quyết toán. Vui lòng mở hồ sơ để đối soát và xem các bước hiện có; việc hết hạn không thay thế sự đồng ý.'],
  SETTLEMENT_PAYMENT_OVERDUE: ['Nghĩa vụ quyết toán cần được kiểm tra', 'Đã qua thời hạn của một nghĩa vụ quyết toán. Vui lòng mở hồ sơ để đối soát khoản thanh toán và xem trạng thái hiện tại.'],
  LEASE_CLOSED: ['Hồ sơ quyết toán cọc đã đóng', 'Hồ sơ quyết toán cọc đã được đóng. Thông báo này không xác nhận các khoản hoàn tiền thuê hoặc công nợ độc lập đã hoàn tất; vui lòng mở hồ sơ để kiểm tra.'],
} as const;
const isReturnSettlementType = (value: string): value is keyof typeof returnSettlementTemplates =>
  Object.hasOwn(returnSettlementTemplates, value);

// Fixed, status-specific copy; the producer only sends the status code.
const listingStatusCopy = {
  PENDING_REVIEW: [
    'Tin đăng đang chờ xét duyệt',
    'Tin đăng của bạn đã được chuyển sang trạng thái chờ xét duyệt.',
  ],
  HIDDEN: [
    'Tin đăng đã bị ẩn',
    'Tin đăng của bạn đã được ẩn khỏi danh sách công khai.',
  ],
  VIOLATION: [
    'Tin đăng bị đánh dấu vi phạm',
    'Tin đăng của bạn đã bị đánh dấu vi phạm quy định. Vui lòng mở tin đăng để xem chi tiết.',
  ],
  RENTED_EXTERNALLY: [
    'Tin đăng đã được ghi nhận đã cho thuê',
    'Tin đăng của bạn đã được ghi nhận là đã cho thuê ngoài nền tảng.',
  ],
} as const;

// Extra required listing data key per event type (besides listingId).
const listingExtraKey: Record<string, 'editId' | 'status' | undefined> = {
  LISTING_EDIT_APPROVED: 'editId',
  LISTING_EDIT_REJECTED: 'editId',
  LISTING_STATUS_CHANGED: 'status',
};

export interface NotificationEvent {
  eventId: string;
  eventType:
    | keyof typeof templates
    | keyof typeof accountTemplates
    | keyof typeof paymentTemplates
    | keyof typeof invoiceTemplates
    | keyof typeof handoverTemplates
    | keyof typeof agreementTemplates
    | keyof typeof amendmentTemplates
    | keyof typeof renewalTemplates
    | keyof typeof terminationTemplates
    | keyof typeof returnSettlementTemplates
    | 'PLATFORM_ANNOUNCEMENT';
  version: 1;
  occurredAt: string;
  recipients: string[];
  data: Record<string, string>;
}

export class InvalidNotificationEvent extends Error {
  constructor() {
    super('Invalid notification event');
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value);
const plainText = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= max &&
  // eslint-disable-next-line no-control-regex -- Reject control characters at the event boundary.
  !/[<>\u0000-\u001f\u007f]/.test(value);
const bookingDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const bookingTime = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function parseNotificationEvent(
  value: Buffer | null,
): NotificationEvent {
  try {
    if (!value || value.length > 65536) throw new InvalidNotificationEvent();
    const input: unknown = JSON.parse(value.toString('utf8'));
    if (
      !object(input) ||
      Object.keys(input).sort().join(',') !==
        'data,eventId,eventType,occurredAt,recipients,version' ||
      !identifier(input.eventId) ||
      input.version !== 1 ||
      typeof input.eventType !== 'string' ||
      !(
        Object.hasOwn(templates, input.eventType) ||
        isAccountType(input.eventType) ||
        isPaymentType(input.eventType) ||
        isInvoiceType(input.eventType) ||
        isHandoverType(input.eventType) ||
        isAgreementType(input.eventType) ||
        isAmendmentType(input.eventType) ||
        isRenewalType(input.eventType) ||
        isTerminationType(input.eventType) ||
        isReturnSettlementType(input.eventType) ||
        input.eventType === 'PLATFORM_ANNOUNCEMENT'
      ) ||
      typeof input.occurredAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.occurredAt) ||
      !Number.isFinite(Date.parse(input.occurredAt)) ||
      new Date(input.occurredAt).toISOString() !== input.occurredAt ||
      !Array.isArray(input.recipients) ||
      input.recipients.length < 1 ||
      input.recipients.length > 100 ||
      !input.recipients.every(identifier) ||
      new Set(input.recipients).size !== input.recipients.length ||
      !object(input.data)
    ) {
      throw new InvalidNotificationEvent();
    }
    const event = input as unknown as NotificationEvent;
    if (isAccountType(event.eventType)) {
      // Exactly one affected account and no producer data (no role, reason, actor or identity).
      if (event.recipients.length !== 1 || Object.keys(event.data).length !== 0)
        throw new InvalidNotificationEvent();
    } else if (isPaymentType(event.eventType)) {
      // Exactly one persisted payer/payee and only the payment id. The established identifier rule is kept
      // (Core payment IDs are 36-char UUIDs and fit); it is URL-safe and the route still encodes it.
      if (
        event.recipients.length !== 1 ||
        Object.keys(event.data).sort().join(',') !== 'paymentId' ||
        !identifier(event.data.paymentId)
      )
        throw new InvalidNotificationEvent();
    } else if (isInvoiceType(event.eventType)) {
      // One persisted party and only the two persisted ids (the identifier rule excludes synthetic `first-rent:*` ids).
      if (
        event.recipients.length !== 1 ||
        Object.keys(event.data).sort().join(',') !== 'contractId,invoiceId' ||
        !identifier(event.data.contractId) ||
        !identifier(event.data.invoiceId)
      )
        throw new InvalidNotificationEvent();
    } else if (isHandoverType(event.eventType)) {
      // One persisted party and only the root lease id; Core decides recipients and state, never the consumer.
      if (
        event.recipients.length !== 1 ||
        Object.keys(event.data).sort().join(',') !== 'contractId' ||
        !identifier(event.data.contractId)
      )
        throw new InvalidNotificationEvent();
    } else if (isAgreementType(event.eventType)) {
      // One persisted party and exactly the signing-envelope id plus a closed kind; Core owns triggers and recipients.
      if (
        event.recipients.length !== 1 ||
        Object.keys(event.data).sort().join(',') !== 'agreementId,agreementKind' ||
        !identifier(event.data.agreementId) ||
        typeof event.data.agreementKind !== 'string' ||
        !agreementKinds.includes(event.data.agreementKind)
      )
        throw new InvalidNotificationEvent();
    } else if (isAmendmentType(event.eventType) || isRenewalType(event.eventType) || isTerminationType(event.eventType) || isReturnSettlementType(event.eventType)) {
      if (event.recipients.length !== 1 || Object.keys(event.data).join(',') !== 'contractId' || !identifier(event.data.contractId))
        throw new InvalidNotificationEvent();
    } else if (event.eventType === 'PLATFORM_ANNOUNCEMENT') {
      if (
        Object.keys(event.data).sort().join(',') !== 'body,title' ||
        !plainText(event.data.title, 200) ||
        !plainText(event.data.body, 2000)
      )
        throw new InvalidNotificationEvent();
    } else {
      const idKey = templates[event.eventType][3];
      const keys = Object.keys(event.data);
      const booking = idKey === 'bookingId';
      const listing = idKey === 'listingId';
      const extra = listingExtraKey[event.eventType];
      if (
        !identifier(event.data[idKey]) ||
        // Membership notices go to the single persisted order owner; keys.length === 1 below keeps data to orderId.
        (idKey === 'orderId' && event.recipients.length !== 1) ||
        (listing
          ? keys.some((key) => key !== 'listingId' && key !== 'listingTitle' && key !== extra) ||
            (Object.hasOwn(event.data, 'listingTitle') && !plainText(event.data.listingTitle, 120)) ||
            (extra === 'editId' && !identifier(event.data.editId)) ||
            (extra === 'status' && (typeof event.data.status !== 'string' || !Object.hasOwn(listingStatusCopy, event.data.status)))
          : booking
          ? keys.some((key) => !['bookingId', 'recipientSide', 'listingTitle', 'appointmentDate', 'startTime'].includes(key)) ||
            (Object.hasOwn(event.data, 'recipientSide') &&
              event.data.recipientSide !== 'OWNER' && event.data.recipientSide !== 'RENTER') ||
            (Object.hasOwn(event.data, 'listingTitle') && !plainText(event.data.listingTitle, 120)) ||
            (Object.hasOwn(event.data, 'appointmentDate') && !bookingDate(event.data.appointmentDate)) ||
            (Object.hasOwn(event.data, 'startTime') && !bookingTime(event.data.startTime))
          : idKey === 'requestId'
          ? keys.some((key) => !['requestId', 'recipientSide', 'listingTitle'].includes(key)) ||
            (event.data.recipientSide !== 'OWNER' && event.data.recipientSide !== 'RENTER') ||
            (Object.hasOwn(event.data, 'listingTitle') && !plainText(event.data.listingTitle, 120))
          : keys.length !== 1)
      )
        throw new InvalidNotificationEvent();
    }
    return event;
  } catch {
    throw new InvalidNotificationEvent();
  }
}

export function renderNotification(
  event: NotificationEvent,
  recipientId: string,
): NewNotification {
  const common = {
    recipientId,
    sourceEventId: event.eventId,
    type: event.eventType,
    priority: 'NORMAL' as const,
  };
  if (event.eventType === 'PLATFORM_ANNOUNCEMENT') {
    return {
      ...common,
      category: 'SYSTEM',
      title: event.data.title,
      body: event.data.body,
    };
  }
  if (isAccountType(event.eventType)) {
    const [title, body] = accountTemplates[event.eventType];
    return {
      ...common,
      category: 'ACCOUNT',
      title,
      body,
      actionPath: ACCOUNT_ACTION_PATH,
    };
  }
  if (isPaymentType(event.eventType)) {
    const [title, body] = paymentTemplates[event.eventType];
    return {
      ...common,
      category: 'PAYMENT',
      title,
      body,
      actionPath: `/dashboard/payments?paymentId=${encodeURIComponent(event.data.paymentId)}`,
      metadata: { paymentId: event.data.paymentId },
    };
  }
  if (isInvoiceType(event.eventType)) {
    const [title, body] = invoiceTemplates[event.eventType];
    const { contractId, invoiceId } = event.data;
    return {
      ...common,
      category: 'PAYMENT',
      title,
      body,
      actionPath: `/dashboard/invoices/${encodeURIComponent(contractId)}?section=monthly&invoice=${encodeURIComponent(invoiceId)}`,
      metadata: { contractId, invoiceId },
    };
  }
  if (isHandoverType(event.eventType)) {
    const [title, body] = handoverTemplates[event.eventType];
    const { contractId } = event.data;
    return {
      ...common,
      category: 'CONTRACT',
      title,
      body,
      actionPath: `/dashboard/invoices/${encodeURIComponent(contractId)}?section=deposit&workflow=move-in`,
      metadata: { contractId },
    };
  }
  if (isAgreementType(event.eventType)) {
    const [title, body] = agreementTemplates[event.eventType];
    const { agreementId, agreementKind } = event.data;
    return {
      ...common,
      category: 'CONTRACT',
      title,
      body,
      actionPath: `/dashboard/contracts/${encodeURIComponent(agreementId)}${agreementKind === 'MOVE_IN' ? '?workflow=move-in' : ''}`,
      metadata: { agreementId, agreementKind },
    };
  }
  if (isAmendmentType(event.eventType)) {
    const [title, body] = amendmentTemplates[event.eventType];
    const { contractId } = event.data;
    return { ...common, category: 'CONTRACT', title, body,
      actionPath: `/dashboard/contracts/${encodeURIComponent(contractId)}`, metadata: { contractId } };
  }
  if (isRenewalType(event.eventType)) {
    const [title, body] = renewalTemplates[event.eventType];
    const { contractId } = event.data;
    return { ...common, category: 'CONTRACT', title, body,
      actionPath: `/dashboard/contracts/${encodeURIComponent(contractId)}`, metadata: { contractId } };
  }
  if (isTerminationType(event.eventType)) {
    const [title, body] = terminationTemplates[event.eventType];
    const { contractId } = event.data;
    return { ...common, category: 'CONTRACT', title, body,
      actionPath: `/dashboard/contracts/${encodeURIComponent(contractId)}`, metadata: { contractId } };
  }
  if (isReturnSettlementType(event.eventType)) {
    const [title, body] = returnSettlementTemplates[event.eventType];
    const { contractId } = event.data;
    const returnRecorded = event.eventType === 'LEASE_RETURN_CONFIRMED' || event.eventType === 'LEASE_RETURN_COMPLETED';
    return { ...common, category: 'CONTRACT', title, body,
      actionPath: returnRecorded ? `/dashboard/contracts/${encodeURIComponent(contractId)}`
        : `/dashboard/invoices/${encodeURIComponent(contractId)}?section=deposit`, metadata: { contractId } };
  }
  const [category, baseTitle, baseBody, idKey] = templates[event.eventType];
  const statusCopy = event.eventType === 'LISTING_STATUS_CHANGED'
    ? listingStatusCopy[event.data.status as keyof typeof listingStatusCopy]
    : undefined;
  const title: string = statusCopy?.[0] ?? baseTitle;
  const body: string = statusCopy?.[1] ?? baseBody;
  const side = idKey === 'bookingId' || idKey === 'requestId' ? event.data.recipientSide : undefined;
  const bookingPath = idKey === 'requestId'
    ? side === 'OWNER' ? '/dashboard/rental-requests' : '/dashboard/rental-requests/my-requests'
    : side === 'OWNER'
      ? '/dashboard/viewing-schedules'
      : side === 'RENTER' ? '/dashboard/viewing-schedules/my-bookings' : undefined;
  const detail = idKey === 'bookingId'
    ? [
        event.data.listingTitle ? `Tin: ${event.data.listingTitle.trim()}.` : '',
        event.data.appointmentDate && event.data.startTime
          ? `Lịch: ${event.data.appointmentDate.slice(8, 10)}/${event.data.appointmentDate.slice(5, 7)}/${event.data.appointmentDate.slice(0, 4)} lúc ${event.data.startTime}.`
          : '',
      ].filter(Boolean).join(' ')
    : (idKey === 'listingId' || idKey === 'requestId') && event.data.listingTitle
      ? `Tin: ${event.data.listingTitle.trim()}.`
      : '';
  return {
    ...common,
    category: category as NotificationCategory,
    title,
    body: detail ? `${body} ${detail}` : body,
    actionPath: idKey === 'listingId'
      ? `/dashboard/properties/view?id=${encodeURIComponent(event.data.listingId)}`
      : idKey === 'orderId'
        ? `/dashboard/membership/return?orderId=${encodeURIComponent(event.data.orderId)}`
      : bookingPath
        ? idKey === 'requestId'
          ? `${bookingPath}?requestId=${encodeURIComponent(event.data.requestId)}`
          : `${bookingPath}?appointmentId=${encodeURIComponent(event.data.bookingId)}`
        : '/notifications',
    metadata: {
      [idKey]: event.data[idKey],
      ...(side ? { recipientSide: side } : {}),
      ...(idKey === 'listingId' && event.data.editId ? { editId: event.data.editId } : {}),
      ...(idKey === 'listingId' && event.data.status ? { status: event.data.status } : {}),
    },
  };
}
