import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { NotificationService } from '../notification/application/notification.service';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  type NewNotification,
} from '../notification/domain/notification.model';
import {
  InMemoryNotificationRepository,
  InMemoryPreferenceRepository,
} from '../notification/testing/in-memory-notification.repository';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationRealtimeService } from '../notification-realtime/notification-realtime.service';
import {
  parseNotificationEvent,
  renderNotification,
} from '../notification-events/notification-event';

function setup() {
  const notifications = new InMemoryNotificationRepository();
  const preferences = new InMemoryPreferenceRepository();
  const delivery = {
    enqueue: jest
      .fn<NotificationDeliveryService['enqueue']>()
      .mockResolvedValue(undefined),
  };
  const realtime = { emitNew: jest.fn(), emitUnreadCount: jest.fn() };
  const service = new NotificationService(
    notifications,
    preferences,
    delivery as unknown as NotificationDeliveryService,
    realtime as unknown as NotificationRealtimeService,
  );
  return { notifications, preferences, delivery, realtime, service };
}

function input(overrides: Partial<NewNotification> = {}): NewNotification {
  return {
    recipientId: 'alice',
    sourceEventId: 'news-1',
    category: 'NEWS',
    type: 'NEWS_PUBLISHED',
    title: 'News published',
    body: 'Read the latest news.',
    priority: 'NORMAL',
    ...overrides,
  };
}

it('persists in-app despite enqueue outage, retries enqueue on replay, and emits realtime only once', async () => {
  const { notifications, preferences, delivery, realtime, service } = setup();
  delivery.enqueue.mockRejectedValueOnce(new Error('outage'));
  const find = jest.spyOn(preferences, 'find');
  const input = renderNotification(
    parseNotificationEvent(
      Buffer.from(
        JSON.stringify({
          eventId: 'booking-transition-1',
          eventType: 'BOOKING_RESCHEDULE_APPROVED',
          version: 1,
          occurredAt: '2026-11-13T00:00:00.000Z',
          recipients: ['alice'],
          data: { bookingId: 'booking-1', recipientSide: 'RENTER' },
        }),
      ),
    ),
    'alice',
  );
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
  expect(realtime.emitNew).toHaveBeenCalledWith(
    'alice',
    expect.objectContaining({
      category: 'APPOINTMENT',
      type: 'BOOKING_RESCHEDULE_APPROVED',
      actionPath:
        '/dashboard/viewing-schedules/my-bookings?appointmentId=booking-1',
      metadata: { bookingId: 'booking-1', recipientSide: 'RENTER' },
    }),
    true,
  );
  expect(realtime.emitUnreadCount).toHaveBeenCalledWith('alice', 1);
  expect(find).toHaveBeenCalledTimes(1);
});

describe.each(NOTIFICATION_CATEGORIES)('%s popup preference', (category) => {
  it.each(NOTIFICATION_PRIORITIES)(
    'suppresses %s popups while preserving delivery and category feed rules',
    async (priority) => {
      const { notifications, preferences, delivery, realtime, service } =
        setup();
      await preferences.save('alice', [{ category, push: false, email: true }]);

      const { notification } = await service.create(
        input({ category, priority }),
      );

      expect(realtime.emitNew).toHaveBeenCalledWith(
        'alice',
        notification,
        false,
      );
      if (category === 'CHAT') {
        expect(realtime.emitUnreadCount).not.toHaveBeenCalled();
      } else {
        expect(realtime.emitUnreadCount).toHaveBeenCalledWith('alice', 1);
      }
      expect(notifications.rows).toHaveLength(1);
      expect((await service.getFeed('alice', {})).items).toEqual(
        category === 'CHAT' ? [] : [notification],
      );
      expect(await service.getUnreadCount('alice')).toEqual({
        count: category === 'CHAT' ? 0 : 1,
      });
      expect(delivery.enqueue).toHaveBeenCalledWith(notification, 'alice');
      expect(notification).not.toHaveProperty('popupAllowed');
    },
  );

  it('defaults popups to enabled for an unconfigured recipient', async () => {
    const { realtime, service } = setup();
    const { notification } = await service.create(input({ category }));
    expect(realtime.emitNew).toHaveBeenCalledWith('alice', notification, true);
  });

  it('defaults popups to enabled for a category missing from older preferences', async () => {
    const { preferences, realtime, service } = setup();
    await preferences.save(
      'alice',
      NOTIFICATION_CATEGORIES.filter((other) => other !== category).map(
        (other) => ({ category: other, push: false, email: false }),
      ),
    );
    const { notification } = await service.create(input({ category }));
    expect(realtime.emitNew).toHaveBeenCalledWith('alice', notification, true);
  });

  it('does not suppress popups when only email is disabled', async () => {
    const { preferences, realtime, service } = setup();
    await preferences.save('alice', [{ category, push: true, email: false }]);
    const { notification } = await service.create(input({ category }));
    expect(realtime.emitNew).toHaveBeenCalledWith('alice', notification, true);
  });
});

it('uses the persisted recipient preference at creation and isolates users', async () => {
  const { preferences, realtime, service } = setup();
  const find = jest.spyOn(preferences, 'find');
  await service.updatePreferences('alice', [
    { category: 'NEWS', push: false, email: false },
  ]);
  const alice = await service.create(input());
  const bob = await service.create(input({ recipientId: 'bob' }));
  await service.updatePreferences('alice', [
    { category: 'NEWS', push: true, email: false },
  ]);
  const enabled = await service.create(input({ sourceEventId: 'news-2' }));

  expect(find.mock.calls).toEqual([['alice'], ['bob'], ['alice']]);
  expect(realtime.emitNew.mock.calls).toEqual([
    ['alice', alice.notification, false],
    ['bob', bob.notification, true],
    ['alice', enabled.notification, true],
  ]);
  expect(await service.getUnreadCount('alice')).toEqual({ count: 2 });
  expect(await service.getUnreadCount('bob')).toEqual({ count: 1 });
});

it('suppresses popups on preference failure but still stores, enqueues and emits feed/unread updates', async () => {
  const { preferences, delivery, realtime, service } = setup();
  jest
    .spyOn(preferences, 'find')
    .mockRejectedValue(new Error('private error detail'));
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  try {
    const { notification, created } = await service.create(input());

    expect(created).toBe(true);
    expect(realtime.emitNew).toHaveBeenCalledWith('alice', notification, false);
    expect(realtime.emitUnreadCount).toHaveBeenCalledWith('alice', 1);
    expect((await service.getFeed('alice', {})).items).toEqual([notification]);
    expect(delivery.enqueue).toHaveBeenCalledWith(notification, 'alice');
    expect(warn).toHaveBeenCalledWith(
      'Realtime popup suppressed: preferences unavailable',
    );
    expect(warn.mock.calls).toHaveLength(1);
  } finally {
    warn.mockRestore();
  }
});

it('does not re-emit an opted-out notification on replay after preferences change', async () => {
  const { delivery, realtime, service } = setup();
  await service.updatePreferences('alice', [
    { category: 'NEWS', push: false, email: false },
  ]);
  const first = await service.create(input());
  await service.updatePreferences('alice', [
    { category: 'NEWS', push: true, email: true },
  ]);
  const replay = await service.create(input());

  expect(replay).toEqual({ notification: first.notification, created: false });
  expect(realtime.emitNew.mock.calls).toEqual([
    ['alice', first.notification, false],
  ]);
  expect(realtime.emitUnreadCount).toHaveBeenCalledTimes(1);
  expect(delivery.enqueue).toHaveBeenCalledTimes(2);
});
