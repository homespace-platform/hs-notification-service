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
      actionPath: '/notifications',
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
