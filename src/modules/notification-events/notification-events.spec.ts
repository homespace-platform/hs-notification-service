import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { Admin } from 'kafkajs';
import { NotificationService } from '../notification/application/notification.service';
import { missingNotificationTopics, NotificationEventsConsumer } from './notification-events.consumer';
import {
  parseNotificationEvent,
  renderNotification,
} from './notification-event';
const event = {
  eventId: 'event-1',
  eventType: 'LISTING_APPROVED',
  version: 1,
  occurredAt: '2026-11-12T00:00:00.000Z',
  recipients: ['alice', 'bob'],
  data: { listingId: 'listing-1' },
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('Kafka topic requirement', () => {
  it('reports either missing topic without creating one', async () => {
    const admin = { listTopics: jest.fn<Admin['listTopics']>().mockResolvedValue(['events']) };
    expect(await missingNotificationTopics(admin, ['events', 'dlt'])).toEqual(['dlt']);
    expect(await missingNotificationTopics(admin, ['other', 'dlt'])).toEqual(['other', 'dlt']);
  });
});
describe('notification event contract', () => {
  it('renders the chat category and conversation metadata', () => {
    const chat = parseNotificationEvent(
      encode({
        ...event,
        eventType: 'CHAT_MESSAGE_RECEIVED',
        data: { conversationId: 'chat-1' },
      }),
    );
    expect(renderNotification(chat, 'alice')).toMatchObject({
      category: 'CHAT',
      title: 'Tin nhắn mới',
      metadata: { conversationId: 'chat-1' },
    });
  });
  it('renders only trusted templates and routes', () => {
    expect(
      renderNotification(parseNotificationEvent(encode(event)), 'alice'),
    ).toMatchObject({
      category: 'LISTING',
      sourceEventId: 'event-1',
      actionPath: '/dashboard/properties/view?id=listing-1',
    });
  });
  it.each([
    { ...event, version: 2 },
    { ...event, recipients: [] },
    { ...event, recipients: ['alice', 'alice'] },
    { ...event, data: { listingId: '../secret' } },
    { ...event, url: 'https://evil' },
    { ...event, eventType: 'UNKNOWN' },
    { ...event, occurredAt: '2026-02-30T00:00:00.000Z' },
    {
      ...event,
      eventType: 'PLATFORM_ANNOUNCEMENT',
      data: { title: '<script>', body: 'x' },
    },
  ])('rejects unsafe or incompatible envelopes', (value) => {
    expect(() => parseNotificationEvent(encode(value))).toThrow(
      'Invalid notification event',
    );
  });
});

describe('platform announcement contract', () => {
  const announcement = {
    ...event,
    eventType: 'PLATFORM_ANNOUNCEMENT',
    data: { title: 'Maintenance', body: 'HomeSpace maintenance tonight.' },
  };
  const adminData = { ...announcement.data, priority: 'URGENT', actionPath: '/news/maintenance' };

  it('keeps legacy announcements valid with default priority and feed route', () => {
    expect(renderNotification(parseNotificationEvent(encode(announcement)), 'alice')).toMatchObject({
      category: 'SYSTEM', type: 'PLATFORM_ANNOUNCEMENT', priority: 'NORMAL',
      title: announcement.data.title, body: announcement.data.body, actionPath: '/notifications',
    });
    expect(() => parseNotificationEvent(encode({ ...announcement,
      data: { ...announcement.data, body: 'Legacy\nmultiline' },
    }))).toThrow('Invalid notification event');
  });

  it.each(['NORMAL', 'HIGH', 'URGENT'])('preserves admin %s priority, safe route and multiline body', (priority) => {
    const data = { ...adminData, priority, body: 'First line\r\nSecond line\tDetails' };
    expect(renderNotification(parseNotificationEvent(encode({ ...announcement, data })), 'alice'))
      .toMatchObject({ category: 'SYSTEM', priority, actionPath: data.actionPath, body: data.body });
  });

  it.each([
    { ...adminData, priority: 'LOW' },
    { ...adminData, priority: null },
    { ...adminData, actionPath: 'https://evil.example' },
    { ...adminData, actionPath: '//evil.example' },
    { ...adminData, actionPath: '/safe/../admin' },
    { ...adminData, actionPath: '/unsafe\\path' },
    { ...adminData, actionPath: `/${'a'.repeat(500)}` },
    { ...adminData, actionPath: null },
    { ...adminData, title: 'Unsafe\ntitle' },
    { ...adminData, body: '<script>' },
    { ...adminData, body: 'Unsafe\u0000body' },
    { ...adminData, body: 'Unsafe\u000bbody' },
    { ...adminData, body: ' \r\n\t ' },
    { ...adminData, body: 'x'.repeat(2001) },
    { ...adminData, extra: 'ignored' },
    { ...announcement.data, priority: 'URGENT' },
    { ...announcement.data, actionPath: '/notifications' },
  ])('rejects unsafe or incomplete admin announcement data %j', (data) => {
    expect(() => parseNotificationEvent(encode({ ...announcement, data })))
      .toThrow('Invalid notification event');
  });
});

describe('role permissions changed contract', () => {
  const changed = { ...event, eventType: 'ROLE_PERMISSIONS_CHANGED', data: { roleName: 'PROPERTY_OWNER' } };

  it('renders a generic SYSTEM notice and keeps roleName in metadata only', () => {
    const rendered = renderNotification(parseNotificationEvent(encode(changed)), 'alice');
    expect(rendered).toMatchObject({
      category: 'SYSTEM', type: 'ROLE_PERMISSIONS_CHANGED', priority: 'NORMAL', recipientId: 'alice',
      title: 'Quyền sử dụng tính năng đã thay đổi', actionPath: '/notifications',
      metadata: { roleName: 'PROPERTY_OWNER' },
    });
    expect(`${rendered.title} ${rendered.body}`).not.toContain('PROPERTY_OWNER');
  });

  it('accepts 100 recipients', () => {
    const recipients = Array.from({ length: 100 }, (_, i) => `u${i}`);
    expect(parseNotificationEvent(encode({ ...changed, recipients })).recipients).toHaveLength(100);
  });

  it.each([
    {},
    { roleName: 'ADMIN', extra: 'x' },
    { role: 'ADMIN' },
    { roleName: 'admin' },
    { roleName: '1ADMIN' },
    { roleName: '_ADMIN' },
    { roleName: 'A'.repeat(51) },
    { roleName: 'ADMIN\n' },
    { roleName: 'ADMIN-X' },
    { roleName: 5 },
  ])('rejects invalid data %j', (data) => {
    expect(() => parseNotificationEvent(encode({ ...changed, data }))).toThrow('Invalid notification event');
  });

  it('rejects empty and oversized recipient lists', () => {
    expect(() => parseNotificationEvent(encode({ ...changed, recipients: [] }))).toThrow('Invalid notification event');
    expect(() => parseNotificationEvent(encode({ ...changed, recipients: Array.from({ length: 101 }, (_, i) => `u${i}`) })))
      .toThrow('Invalid notification event');
  });
});

describe('booking notification contract', () => {
  const bookingId = '2f89a556-7a9b-4865-aa9f-924531995bd2';
  const types = [
    'BOOKING_REQUESTED', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED',
    'BOOKING_REJECTED', 'BOOKING_RESCHEDULE_REQUESTED',
    'BOOKING_RESCHEDULE_APPROVED', 'BOOKING_RESCHEDULE_REJECTED',
    'BOOKING_COMPLETED', 'BOOKING_EXPIRED',
  ];

  it.each(types)('renders %s for both recipient sides and legacy events', (eventType) => {
    for (const recipientSide of ['OWNER', 'RENTER']) {
      const parsed = parseNotificationEvent(encode({
        ...event, eventType, data: { recipientSide, bookingId },
      }));
      const notification = renderNotification(parsed, 'alice');
      const path = recipientSide === 'OWNER'
        ? '/dashboard/viewing-schedules'
        : '/dashboard/viewing-schedules/my-bookings';
      expect(notification).toMatchObject({
        recipientId: 'alice', sourceEventId: event.eventId, type: eventType,
        category: 'APPOINTMENT', priority: 'NORMAL',
        actionPath: `${path}?appointmentId=${bookingId}`,
        metadata: { bookingId, recipientSide },
      });
      expect(notification.title).toBeTruthy();
      expect(notification.body).toBeTruthy();
    }
    const legacy = parseNotificationEvent(encode({ ...event, eventType, data: { bookingId } }));
    expect(renderNotification(legacy, 'alice')).toMatchObject({
      actionPath: '/notifications', metadata: { bookingId },
    });
  });

  it.each(types)('adds listing and schedule context to %s', (eventType) => {
    const parsed = parseNotificationEvent(encode({
      ...event, eventType,
      data: {
        bookingId, recipientSide: 'OWNER', listingTitle: 'Căn hộ Quận 1',
        appointmentDate: '2026-11-15', startTime: '09:30',
      },
    }));
    expect(renderNotification(parsed, 'alice')).toMatchObject({
      category: 'APPOINTMENT',
      actionPath: `/dashboard/viewing-schedules?appointmentId=${bookingId}`,
      metadata: { bookingId, recipientSide: 'OWNER' },
    });
    expect(renderNotification(parsed, 'alice').body).toContain('Tin: Căn hộ Quận 1. Lịch: 15/11/2026 lúc 09:30.');
  });

  it.each([
    { listingTitle: '' }, { listingTitle: '<script>' },
    { listingTitle: 'x'.repeat(121) }, { listingTitle: 'x\nunsafe' },
    { appointmentDate: '2026-02-30' }, { appointmentDate: '15/11/2026' },
    { startTime: '24:00' }, { startTime: '09:60' },
    { extra: 'x' },
  ])('rejects invalid booking context %j', (bad) => {
    expect(() => parseNotificationEvent(encode({
      ...event, eventType: 'BOOKING_REQUESTED',
      data: { bookingId, recipientSide: 'OWNER', ...bad },
    }))).toThrow('Invalid notification event');
  });

  it.each([
    { bookingId, recipientSide: 'ADMIN' },
    { bookingId, recipientSide: '' },
    { bookingId, recipientSide: null },
    { bookingId, recipientSide: ['OWNER'] },
    { bookingId, recipientSide: 'OWNER', actionPath: 'https://evil.example' },
    { bookingId: '../secret', recipientSide: 'OWNER' },
    { recipientSide: 'OWNER' },
  ])('rejects invalid booking data %j', (data) => {
    expect(() => parseNotificationEvent(encode({ ...event, eventType: 'BOOKING_CANCELLED', data })))
      .toThrow('Invalid notification event');
  });

  it('does not extend non-booking resource contracts with recipientSide', () => {
    expect(() => parseNotificationEvent(encode({
      ...event, data: { listingId: 'listing-1', recipientSide: 'OWNER' },
    }))).toThrow('Invalid notification event');
  });
});

describe('Kafka delivery', () => {
  const digest = {
    ...event,
    eventId: 'digest-1',
    eventType: 'BRANCH_DAILY_DIGEST',
    recipients: ['owner-a'],
    data: { attentionCount: '2' },
  };
  const setup = () => {
    const create = jest
      .fn<NotificationService['create']>()
      .mockResolvedValue({} as never);
    const send = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(undefined);
    const commitOffsets = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(undefined);
    const config = new ConfigService({
      KAFKA_RETRY_ATTEMPTS: 2,
      KAFKA_RETRY_DELAY_MS: 0,
      KAFKA_DLT_TOPIC: 'test-dlt',
    });
    const service = new NotificationEventsConsumer(config, {
      create,
    } as unknown as NotificationService);
    Object.assign(service, { consumer: { commitOffsets }, producer: { send } });
    const payload = {
      topic: 'events',
      partition: 0,
      message: { offset: '9007199254740993', value: encode(event) },
      heartbeat: async () => undefined,
    } as unknown as Parameters<typeof service.consume>[0];
    return { service, create, send, commitOffsets, payload };
  };
  it('persists all recipients before committing the exact next offset', async () => {
    const x = setup();
    await x.service.consume(x.payload);
    expect(x.create).toHaveBeenCalledTimes(2);
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledWith([
      { topic: 'events', partition: 0, offset: '9007199254740994' },
    ]);
    expect(x.create.mock.invocationCallOrder[1]).toBeLessThan(
      x.commitOffsets.mock.invocationCallOrder[0],
    );
  });
  it('replays a digest with the same owner and id and still processes an older event type', async () => {
    const x = setup();
    const digestMessage = { ...x.payload, message: { ...x.payload.message, value: encode(digest) } };
    await x.service.consume(digestMessage);
    await x.service.consume(digestMessage);
    expect(x.create.mock.calls.map(([input]) => [input.recipientId, input.sourceEventId]))
      .toEqual([['owner-a', 'digest-1'], ['owner-a', 'digest-1']]);
    expect(x.create).toHaveBeenCalledWith(expect.objectContaining({
      category: 'SYSTEM', actionPath: '/dashboard/branches', metadata: {},
    }));
    await x.service.consume(x.payload);
    expect(x.create).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'LISTING_APPROVED', recipientId: 'bob', sourceEventId: 'event-1',
    }));
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledTimes(3);
  });
  it('quarantines malformed digest data without copying recipients or private fields', async () => {
    const x = setup();
    x.payload.message.value = encode({ ...digest, data: { ...digest.data, roomCode: 'private-room' } });
    await x.service.consume(x.payload);
    expect(x.create).not.toHaveBeenCalled();
    const dlt = JSON.stringify(x.send.mock.calls);
    expect(dlt).toContain('INVALID_EVENT');
    expect(dlt).not.toMatch(/private-room|owner-a/);
    expect(x.send.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });
  it('retries a partial fanout then completes without quarantine', async () => {
    const x = setup();
    x.create
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('database unavailable'));
    await x.service.consume(x.payload);
    expect(x.create).toHaveBeenCalledTimes(4);
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledTimes(1);
  });
  it('retains exhausted persistence failures for durable source replay', async () => {
    const x = setup();
    x.create.mockRejectedValue(new Error('secret password'));
    await expect(x.service.consume(x.payload)).rejects.toThrow(
      'Notification persistence unavailable',
    );
    expect(x.create).toHaveBeenCalledTimes(2);
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).not.toHaveBeenCalled();
  });
  it('does not commit when DLT persistence fails', async () => {
    const x = setup();
    x.payload.message.value = Buffer.from('{');
    x.send.mockRejectedValue(new Error('broker down'));
    await expect(x.service.consume(x.payload)).rejects.toThrow('broker down');
    expect(x.commitOffsets).not.toHaveBeenCalled();
  });
  it('redacts poison messages and skips persistence', async () => {
    const x = setup();
    x.payload.message.value = encode({ password: 'private' });
    await x.service.consume(x.payload);
    expect(x.create).not.toHaveBeenCalled();
    expect(JSON.stringify(x.send.mock.calls)).not.toContain('private');
    expect(JSON.stringify(x.send.mock.calls)).toContain('9007199254740993');
  });
});
