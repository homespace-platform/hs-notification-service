import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { Namespace } from 'socket.io';
import { NotificationService } from '../notification/application/notification.service';
import { InMemoryNotificationRepository, InMemoryPreferenceRepository } from '../notification/testing/in-memory-notification.repository';
import { NotificationRealtimeService } from '../notification-realtime/notification-realtime.service';
import { NotificationEventsConsumer } from './notification-events.consumer';
import { parseNotificationEvent, renderNotification } from './notification-event';

const chat = {
  eventId: 'chat_message-1',
  eventType: 'CHAT_ALERT_REQUESTED',
  version: 1,
  occurredAt: '2026-11-15T00:00:00.000Z',
  recipients: ['alice'],
  data: { conversationId: 'conversation-1', messageId: 'message-1' },
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('chat alert contract', () => {
  it('accepts only the minimal recipient-scoped payload and cannot render a feed notification', () => {
    const parsed = parseNotificationEvent(encode(chat));
    expect(parsed).toEqual(chat);
    expect(() => renderNotification(parsed, 'alice')).toThrow('Invalid notification event');
  });

  it.each([
    { ...chat, recipients: ['alice', 'bob'] },
    { ...chat, eventId: 'chat_other-message' },
    { ...chat, data: { ...chat.data, body: 'private message' } },
    { ...chat, data: { conversationId: 'conversation-1' } },
    { ...chat, data: { ...chat.data, messageId: '../message' } },
  ])('rejects invalid or private fields', (value) => {
    expect(() => parseNotificationEvent(encode(value))).toThrow('Invalid notification event');
  });
});

describe('Kafka chat alert delivery', () => {
  const setup = () => {
    const notifications = new InMemoryNotificationRepository();
    const preferences = new InMemoryPreferenceRepository();
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const realtime = new NotificationRealtimeService();
    realtime.attach({ to } as unknown as Namespace);
    const service = new NotificationService(notifications, preferences, undefined, realtime);
    const consumer = new NotificationEventsConsumer(new ConfigService({
      KAFKA_RETRY_ATTEMPTS: 2,
      KAFKA_RETRY_DELAY_MS: 0,
      KAFKA_DLT_TOPIC: 'test-dlt',
    }), service);
    const commitOffsets = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const send = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    Object.assign(consumer, { consumer: { commitOffsets }, producer: { send } });
    const payload = {
      topic: 'events', partition: 0,
      message: { offset: '4', value: encode(chat) },
      heartbeat: async () => undefined,
    } as unknown as Parameters<typeof consumer.consume>[0];
    return { notifications, preferences, service, consumer, payload, to, emit, commitOffsets, send };
  };

  it('emits only to the authenticated recipient room, commits, and leaves feed and unread untouched', async () => {
    const x = setup();
    await x.consumer.consume(x.payload);
    expect(x.to.mock.calls).toEqual([['user:alice']]);
    expect(x.emit.mock.calls).toEqual([['chat:alert', {
      eventId: chat.eventId, ...chat.data,
    }]]);
    expect((await x.service.getFeed('alice', {})).items).toEqual([]);
    expect(await x.service.getUnreadCount('alice')).toEqual({ count: 0 });
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledWith([{ topic: 'events', partition: 0, offset: '5' }]);
    expect(x.emit.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });

  it('respects CHAT push opt-out without persisting or emitting', async () => {
    const x = setup();
    await x.preferences.patch('alice', 'CHAT', 'push', false);
    await x.consumer.consume(x.payload);
    expect(x.emit).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledTimes(1);
    expect(await x.service.getUnreadCount('alice')).toEqual({ count: 0 });
  });

  it('retries preference failures and leaves the source offset uncommitted', async () => {
    const x = setup();
    const find = jest.spyOn(x.preferences, 'find').mockRejectedValue(new Error('database unavailable'));
    await expect(x.consumer.consume(x.payload)).rejects.toThrow('Notification persistence unavailable');
    expect(find).toHaveBeenCalledTimes(2);
    expect(x.emit).not.toHaveBeenCalled();
    expect(x.commitOffsets).not.toHaveBeenCalled();
    expect(x.send).not.toHaveBeenCalled();
  });

  it('retries socket emission failure before committing the offset', async () => {
    const x = setup();
    x.emit.mockImplementationOnce(() => { throw new Error('socket unavailable'); });
    await x.consumer.consume(x.payload);
    expect(x.emit).toHaveBeenCalledTimes(2);
    expect(x.commitOffsets).toHaveBeenCalledTimes(1);
    expect(x.send).not.toHaveBeenCalled();
  });

  it('replay can duplicate the same eventId for client deduplication', async () => {
    const x = setup();
    await x.consumer.consume(x.payload);
    await x.consumer.consume(x.payload);
    expect(x.emit.mock.calls).toEqual([
      ['chat:alert', { eventId: chat.eventId, ...chat.data }],
      ['chat:alert', { eventId: chat.eventId, ...chat.data }],
    ]);
  });
});
