import { parseNotificationEvent, renderNotification } from './notification-event';

const event = (data: Record<string, unknown>) => Buffer.from(JSON.stringify({
  eventId: 'saved-listing-1',
  eventType: 'SAVED_LISTING_UNAVAILABLE',
  version: 1,
  occurredAt: '2026-11-17T00:00:00.000Z',
  recipients: ['saved-user'],
  data,
}));

describe('saved listing notification contract', () => {
  it('routes a private watcher alert to their saved listings', () => {
    const parsed = parseNotificationEvent(event({ listingId: 'listing-1' }));
    expect(renderNotification(parsed, 'saved-user')).toMatchObject({
      category: 'LISTING',
      type: 'SAVED_LISTING_UNAVAILABLE',
      actionPath: '/favorites',
      metadata: { listingId: 'listing-1' },
    });
  });

  it('rejects missing identity and private listing context', () => {
    expect(() => parseNotificationEvent(event({}))).toThrow();
    expect(() => parseNotificationEvent(event({ listingId: '../other' }))).toThrow();
    expect(() => parseNotificationEvent(event({ listingId: 'listing-1', reason: 'private' }))).toThrow();
  });
});
