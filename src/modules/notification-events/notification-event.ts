import type {
  NewNotification,
  NotificationCategory,
} from '../notification/domain/notification.model';

const templates = {
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
      if (
        Object.keys(event.data).join(',') !== idKey ||
        !identifier(event.data[idKey])
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
  const [category, title, body, idKey] = templates[event.eventType];
  return {
    ...common,
    category: category as NotificationCategory,
    title,
    body,
    actionPath: '/notifications',
    metadata: { [idKey]: event.data[idKey] },
  };
}
