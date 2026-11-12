import { jest } from '@jest/globals';
import { NotificationService } from '../notification/application/notification.service';
import {
  InMemoryNotificationRepository,
  InMemoryPreferenceRepository,
} from '../notification/testing/in-memory-notification.repository';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationRealtimeService } from '../notification-realtime/notification-realtime.service';
import { parseNotificationEvent, renderNotification } from '../notification-events/notification-event';

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
  const input = renderNotification(parseNotificationEvent(Buffer.from(JSON.stringify({
    eventId: 'booking-transition-1', eventType: 'BOOKING_RESCHEDULE_APPROVED',
    version: 1, occurredAt: '2026-11-13T00:00:00.000Z', recipients: ['alice'],
    data: { bookingId: 'booking-1', recipientSide: 'RENTER' },
  }))), 'alice');
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
  expect(realtime.emitNew).toHaveBeenCalledWith('alice', expect.objectContaining({
    category: 'APPOINTMENT', type: 'BOOKING_RESCHEDULE_APPROVED',
    actionPath: '/dashboard/viewing-schedules/my-bookings?appointmentId=booking-1',
    metadata: { bookingId: 'booking-1', recipientSide: 'RENTER' },
  }));
  expect(realtime.emitUnreadCount).toHaveBeenCalledWith('alice', 1);
});
