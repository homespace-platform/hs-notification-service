import { parseNotificationEvent, renderNotification } from './notification-event';

const event = (data: Record<string, unknown>, eventType = 'SAVED_LISTING_UNAVAILABLE', recipients = ['saved-user']) => Buffer.from(JSON.stringify({
  eventId: 'saved-listing-1',
  eventType,
  version: 1,
  occurredAt: '2026-11-17T00:00:00.000Z',
  recipients,
  data,
}));

describe('saved listing notification contract', () => {
  it('routes a private watcher alert to their saved listings', () => {
    const parsed = parseNotificationEvent(event({ listingId: 'listing-1', listingTitle: 'Căn hộ thử nghiệm' }));
    expect(renderNotification(parsed, 'saved-user')).toMatchObject({
      category: 'LISTING',
      type: 'SAVED_LISTING_UNAVAILABLE',
      actionPath: '/favorites',
      metadata: { listingId: 'listing-1' },
    });
    expect(renderNotification(parsed, 'saved-user').body).toContain('Căn hộ thử nghiệm');
  });

  it('opens the public listing after a visible content update and accepts id-only events', () => {
    const parsed = parseNotificationEvent(event({ listingId: 'listing-1' }, 'SAVED_LISTING_UPDATED'));
    expect(renderNotification(parsed, 'saved-user')).toMatchObject({
      type: 'SAVED_LISTING_UPDATED', actionPath: '/rent/listing-1', metadata: { listingId: 'listing-1' },
    });
  });

  it.each(['SAVED_LISTING_UNAVAILABLE', 'SAVED_LISTING_UPDATED'])('%s rejects missing identity, private context and fanout', type => {
    expect(() => parseNotificationEvent(event({}, type))).toThrow();
    expect(() => parseNotificationEvent(event({ listingId: '../other' }, type))).toThrow();
    expect(() => parseNotificationEvent(event({ listingId: 'listing-1', reason: 'private' }, type))).toThrow();
    expect(() => parseNotificationEvent(event({ listingId: 'listing-1', listingTitle: '<script>' }, type))).toThrow();
    expect(() => parseNotificationEvent(event({ listingId: 'listing-1' }, type, ['one', 'two']))).toThrow();
  });
});
