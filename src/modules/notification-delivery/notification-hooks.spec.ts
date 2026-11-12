import { jest } from '@jest/globals';
import { NotificationService } from '../notification/application/notification.service';
import {
  InMemoryNotificationRepository,
  InMemoryPreferenceRepository,
} from '../notification/testing/in-memory-notification.repository';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationRealtimeService } from '../notification-realtime/notification-realtime.service';

it('persists in-app despite enqueue outage, retries enqueue on replay, and emits realtime only once', async () => {
  const notifications = new InMemoryNotificationRepository();
  const delivery = {
    enqueue: jest
      .fn<NotificationDeliveryService['enqueue']>()
      .mockRejectedValueOnce(new Error('outage'))
      .mockResolvedValue(undefined),
  };
  const realtime = { emitNew: jest.fn(), emitUnreadCount: jest.fn() };
  const service = new NotificationService(
    notifications,
    new InMemoryPreferenceRepository(),
    delivery as unknown as NotificationDeliveryService,
    realtime as unknown as NotificationRealtimeService,
  );
  const input = {
    recipientId: 'alice',
    sourceEventId: 'event-1',
    category: 'SYSTEM' as const,
    type: 'SYSTEM_NOTICE',
    title: 'Notice',
    body: 'Notice body',
    priority: 'NORMAL' as const,
  };
  const first = await service.create(input);
  const replay = await service.create(input);
  expect(first.created).toBe(true);
  expect(replay.created).toBe(false);
  expect(notifications.rows).toHaveLength(1);
  expect(delivery.enqueue).toHaveBeenCalledTimes(2);
  expect(delivery.enqueue).toHaveBeenLastCalledWith(
    first.notification,
    'alice',
  );
  expect(realtime.emitNew).toHaveBeenCalledTimes(1);
  expect(realtime.emitUnreadCount).toHaveBeenCalledWith('alice', 1);
});
