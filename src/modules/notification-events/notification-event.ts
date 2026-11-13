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
  CHAT_MESSAGE_RECEIVED: [
    'CHAT',
    'Tin nhắn mới',
    'Bạn vừa nhận được một tin nhắn mới.',
    'conversationId',
  ],
} as const;

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
  eventType: keyof typeof templates | 'PLATFORM_ANNOUNCEMENT';
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
    if (event.eventType === 'PLATFORM_ANNOUNCEMENT') {
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
