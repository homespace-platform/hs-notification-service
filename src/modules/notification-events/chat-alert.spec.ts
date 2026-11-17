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
  it('accepts only the minimal recipient-scoped payload and renders a safe chat notification', () => {
    const parsed = parseNotificationEvent(encode(chat));
    expect(parsed).toEqual(chat);
    expect(renderNotification(parsed, 'alice')).toMatchObject({
      recipientId: 'alice', sourceEventId: chat.eventId, category: 'CHAT',
      actionPath: '/chat?channel=direct&conversationId=conversation-1',
      metadata: chat.data,
    });
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
    const enqueue = jest.fn(async () => undefined);
    const service = new NotificationService(notifications, preferences, { enqueue } as never, realtime);
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
    return { notifications, preferences, service, consumer, payload, to, emit, enqueue, commitOffsets, send };
  };

  it('stores a delivery record, emits one popup and never adds chat to the bell', async () => {
    const x = setup();
    await x.consumer.consume(x.payload);
    expect(x.to.mock.calls).toEqual([['user:alice']]);
    expect(x.emit.mock.calls[0]).toEqual(['notification:new', expect.objectContaining({
      category: 'CHAT', type: 'CHAT_ALERT_REQUESTED', popupAllowed: true,
    })]);
    expect(x.emit).toHaveBeenCalledTimes(1);
    expect(x.notifications.rows).toHaveLength(1);
    expect((await x.service.getFeed('alice', {})).items).toHaveLength(0);
    expect((await x.service.getFeed('alice', { category: 'CHAT' })).items).toHaveLength(0);
    expect((await x.service.getFeed('bob', {})).items).toHaveLength(0);
    expect(await x.service.getUnreadCount('alice')).toEqual({ count: 0 });
    expect(x.enqueue).toHaveBeenCalledWith(expect.objectContaining({category: 'CHAT'}), 'alice');
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledWith([{ topic: 'events', partition: 0, offset: '5' }]);
    expect(x.emit.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });

  it('respects CHAT push opt-out while retaining the internal delivery record', async () => {
    const x = setup();
    await x.preferences.patch('alice', 'CHAT', 'push', false);
    await x.consumer.consume(x.payload);
    expect(x.emit.mock.calls[0]).toEqual(['notification:new', expect.objectContaining({popupAllowed: false})]);
    expect(x.commitOffsets).toHaveBeenCalledTimes(1);
    expect(await x.service.getUnreadCount('alice')).toEqual({ count: 0 });
  });

  it('keeps persisted chat if preference lookup fails', async () => {
    const x = setup();
    const find = jest.spyOn(x.preferences, 'find').mockRejectedValue(new Error('database unavailable'));
    await x.consumer.consume(x.payload);
    expect(find).toHaveBeenCalledTimes(1);
    expect(x.emit.mock.calls[0]).toEqual(['notification:new', expect.objectContaining({popupAllowed: false})]);
    expect(x.notifications.rows).toHaveLength(1);
    expect(x.commitOffsets).toHaveBeenCalledTimes(1);
    expect(x.send).not.toHaveBeenCalled();
  });

  it('retains persisted chat and commits if realtime delivery fails', async () => {
    const x = setup();
    x.emit.mockImplementationOnce(() => { throw new Error('socket unavailable'); });
    await x.consumer.consume(x.payload);
    expect(x.emit).toHaveBeenCalledTimes(1);
    expect(x.notifications.rows).toHaveLength(1);
    expect(x.commitOffsets).toHaveBeenCalledTimes(1);
    expect(x.send).not.toHaveBeenCalled();
  });

  it('does not commit the source offset when chat persistence fails', async () => {
    const x = setup();
    jest.spyOn(x.notifications, 'insertIfAbsent').mockRejectedValue(new Error('database unavailable'));
    await expect(x.consumer.consume(x.payload)).rejects.toThrow('Notification persistence unavailable');
    expect(x.commitOffsets).not.toHaveBeenCalled();
    expect(x.send).not.toHaveBeenCalled();
  });

  it('replay does not duplicate the delivery record or realtime popup', async () => {
    const x = setup();
    await x.consumer.consume(x.payload);
    await x.consumer.consume(x.payload);
    expect(x.notifications.rows).toHaveLength(1);
    expect(x.emit.mock.calls.filter(([event]) => event === 'notification:new')).toHaveLength(1);
    expect(x.commitOffsets).toHaveBeenCalledTimes(2);
  });
});
