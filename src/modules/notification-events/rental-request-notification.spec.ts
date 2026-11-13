import { jest } from '@jest/globals';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NotificationService } from '../notification/application/notification.service';
import { NOTIFICATION_CATEGORIES } from '../notification/domain/notification.model';
import { isSafeActionPath } from '../notification/domain/notification-content';
import { FeedQueryDto, UpdatePreferencesDto } from '../notification/presentation/dto/notification.dto';
import { InMemoryNotificationRepository, InMemoryPreferenceRepository } from '../notification/testing/in-memory-notification.repository';
import { NotificationRealtimeService } from '../notification-realtime/notification-realtime.service';
import { parseNotificationEvent, renderNotification } from './notification-event';

const types = [
  'RENTAL_REQUEST_SUBMITTED', 'RENTAL_REQUEST_ACCEPTED', 'RENTAL_REQUEST_REJECTED', 'RENTAL_REQUEST_AUTO_REJECTED',
  'RENTAL_REQUEST_CANCELLED', 'RENTAL_REQUEST_EXPIRED', 'RENTAL_HOLD_EXPIRED',
  'RENTAL_CANCELLATION_REQUESTED', 'RENTAL_CANCELLATION_REFUND_PENDING', 'RENTAL_CANCELLATION_REJECTED',
  'RENTAL_CANCELLATION_WITHDRAWN', 'RENTAL_CANCELLATION_DISPUTED',
  'RENTAL_START_CHANGE_REQUESTED', 'RENTAL_START_CHANGE_APPROVED', 'RENTAL_START_CHANGE_REJECTED',
  'RENTAL_START_CHANGE_WITHDRAWN', 'RENTAL_START_CHANGE_EXPIRED',
  'RENTAL_SIGNING_WINDOW_REOPENED', 'RENTAL_HOLD_EXTENDED', 'RENTAL_DEFAULT_NOTICE_ISSUED',
  'RENTAL_DEFAULT_DISPUTED', 'RENTAL_REQUEST_CANCELLED_BY_SYSTEM', 'RENTAL_RESUME_REQUESTED',
  'RENTAL_RESUMED', 'RENTAL_RESUME_REJECTED', 'RENTAL_RESUME_WITHDRAWN',
];
const requestId = '11111111-1111-4111-8111-111111111111';
const parse = (type: string, data: unknown, eventId = 'event-rental-1') => parseNotificationEvent(Buffer.from(JSON.stringify({
  eventId, eventType: type, version: 1, occurredAt: '2026-11-13T00:00:00.000Z', recipients: ['owner'], data,
})));

describe('rental request notification acceptance', () => {
  it.each(types)('%s accepts both sides with strict metadata, category and fixed detail route', (type) => {
    for (const recipientSide of ['OWNER', 'RENTER']) {
      for (const title of [undefined, ' Căn hộ thử nghiệm ', 'x'.repeat(120)]) {
        const input = { requestId, recipientSide, ...(title ? { listingTitle: title } : {}) };
        const event = parse(type, input);
        const rendered = renderNotification(event, recipientSide.toLowerCase());
        expect(rendered.category).toBe('RENTAL_REQUEST'); expect(NOTIFICATION_CATEGORIES).toContain(rendered.category);
        expect(rendered.type).toBe(type); expect(rendered.priority).toBe('NORMAL');
        expect(rendered.metadata).toEqual({ requestId, recipientSide });
        expect(rendered.actionPath).toBe(`/dashboard/rental-requests${recipientSide === 'RENTER' ? '/my-requests' : ''}?requestId=${requestId}`);
        expect(isSafeActionPath(rendered.actionPath)).toBe(true);
        if (title) expect(rendered.body).toContain(title.trim());
        else expect(rendered.body).not.toContain('Tin:');
      }
    }
  });

  it.each(types)('%s rejects malformed or private producer data', (type) => {
    const valid = { requestId, recipientSide: 'OWNER' };
    for (const data of [
      { requestId }, { recipientSide: 'OWNER' },
      ...[null, '', 42, '../id', 'a/b', 'x'.repeat(201)].map(requestId => ({ ...valid, requestId })),
      ...[null, '', 'ADMIN', 'owner', 12, [], {}].map(recipientSide => ({ ...valid, recipientSide })),
      ...[null, '', '  ', '<secret>', 'bad\ntext', 'bad\u0000text', 'x'.repeat(121), 5].map(listingTitle => ({ ...valid, listingTitle })),
      ...['rentalRequestId', 'reason', 'amount', 'changeId', 'status', 'deadline', 'actionPath', 'url', '__proto__'].map(key =>
        JSON.parse(JSON.stringify(valid).slice(0, -1) + `,"${key}":"private"}`)),
    ]) expect(() => parse(type, data)).toThrow('Invalid notification event');
  });

  it('refund pending never claims final cancellation or funds received', () => {
    const result = renderNotification(parse('RENTAL_CANCELLATION_REFUND_PENDING', { requestId, recipientSide: 'RENTER' }), 'renter');
    expect(result.body).toContain('chưa hoàn tất');
    expect(result.title).toContain('chờ');
    expect(renderNotification(parse('RENTAL_REQUEST_AUTO_REJECTED', { requestId, recipientSide: 'RENTER' }), 'renter').body).toContain('khác');
    expect(renderNotification(parse('RENTAL_SIGNING_WINDOW_REOPENED', { requestId, recipientSide: 'RENTER' }), 'renter').body).toContain('chưa được ký');
  });

  it('old preferences gain rental defaults while a new category opt-out persists', async () => {
    const preferences = new InMemoryPreferenceRepository();
    await preferences.save('owner', NOTIFICATION_CATEGORIES.filter(c => c !== 'RENTAL_REQUEST')
      .map(category => ({ category, push: false, email: false })));
    const service = new NotificationService(new InMemoryNotificationRepository(), preferences);
    expect((await service.getPreferences('owner')).find(p => p.category === 'RENTAL_REQUEST'))
      .toEqual({ category: 'RENTAL_REQUEST', push: true, email: true });
    await service.updatePreferences('owner', [{ category: 'RENTAL_REQUEST', push: false, email: false }]);
    expect((await service.getPreferences('owner')).find(p => p.category === 'RENTAL_REQUEST')?.push).toBe(false);
    expect((await service.getPreferences('renter')).find(p => p.category === 'RENTAL_REQUEST')?.push).toBe(true);
  });

  it('DTOs accept the category in feeds and preferences, with all eight categories', async () => {
    expect(await validate(plainToInstance(FeedQueryDto, { category: 'RENTAL_REQUEST' }))).toEqual([]);
    expect(await validate(plainToInstance(UpdatePreferencesDto, { items: NOTIFICATION_CATEGORIES
      .map(category => ({ category, push: true, email: false })) }))).toEqual([]);
  });

  it('all types persist once per recipient and realtime never exposes source or other party identity', async () => {
    const repository = new InMemoryNotificationRepository(), emitNew = jest.fn<NotificationRealtimeService['emitNew']>();
    const service = new NotificationService(repository, new InMemoryPreferenceRepository(), undefined,
      { emitNew, emitUnreadCount: jest.fn() } as unknown as NotificationRealtimeService);
    for (const [index, type] of types.entries()) {
      const event = parse(type, { requestId, recipientSide: 'OWNER' }, `rental-event-${index}`);
      const first = await service.create(renderNotification(event, 'owner'));
      expect((await service.create(renderNotification(event, 'owner'))).notification.id).toBe(first.notification.id);
      expect(first.notification).not.toHaveProperty('recipientId'); expect(first.notification).not.toHaveProperty('sourceEventId');
      expect(emitNew).toHaveBeenLastCalledWith('owner', first.notification);
    }
    expect(emitNew).toHaveBeenCalledTimes(26);
    expect((await service.getFeed('owner', { category: 'RENTAL_REQUEST', limit: 50 })).items).toHaveLength(26);
    expect((await service.getFeed('renter', {})).items).toEqual([]);
  });
});
