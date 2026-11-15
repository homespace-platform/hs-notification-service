import { jest } from '@jest/globals';
import type { Namespace } from 'socket.io';
import type { NotificationView } from '../notification/application/notification.service';
import { NotificationRealtimeService } from './notification-realtime.service';

it('adds a server popup decision only to recipient-scoped notification:new payloads', () => {
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  const service = new NotificationRealtimeService();
  service.attach({ to } as unknown as Namespace);
  const notification: NotificationView = {
    id: 'notification-1',
    category: 'NEWS',
    type: 'NEWS_PUBLISHED',
    title: 'News published',
    body: 'Read the latest news.',
    priority: 'URGENT',
    actionPath: '/news/latest',
    metadata: null,
    createdAt: new Date('2026-11-15T00:00:00Z'),
    readAt: null,
  };

  service.emitNew('alice', notification, false);
  service.emitNew('bob', notification);
  service.emitNew('alice', notification, true);
  service.emitRead('alice', notification);
  service.emitUnreadCount('alice', 1);

  expect(to.mock.calls).toEqual([
    ['user:alice'],
    ['user:bob'],
    ['user:alice'],
    ['user:alice'],
    ['user:alice'],
  ]);
  expect(emit.mock.calls).toEqual([
    ['notification:new', { ...notification, popupAllowed: false }],
    ['notification:new', { ...notification, popupAllowed: true }],
    ['notification:new', { ...notification, popupAllowed: true }],
    ['notification:read', notification],
    ['notification:unread-count', { count: 1 }],
  ]);
  expect(notification).not.toHaveProperty('popupAllowed');
});
