import { jest } from '@jest/globals';
import { NotificationService } from '../notification/application/notification.service';
import { isSafeActionPath } from '../notification/domain/notification-content';
import { InMemoryNotificationRepository, InMemoryPreferenceRepository } from '../notification/testing/in-memory-notification.repository';
import { NotificationRealtimeService } from '../notification-realtime/notification-realtime.service';
import { parseNotificationEvent, renderNotification } from './notification-event';

const listingId = 'listing_1-ABC';
const editId = 'edit-1';
const statuses = ['PENDING_REVIEW', 'HIDDEN', 'VIOLATION', 'RENTED_EXTERNALLY'] as const;
const cases = [
  ['LISTING_APPROVED', {}, 'Tin đăng đã được duyệt'],
  ['LISTING_REJECTED', {}, 'Tin đăng chưa được duyệt'],
  ['LISTING_CREATED', {}, 'Tin đăng đã được tạo'],
  ['LISTING_UPDATED', {}, 'Tin đăng đã được cập nhật'],
  ['LISTING_EDIT_APPROVED', { editId }, 'Chỉnh sửa tin đăng đã được duyệt'],
  ['LISTING_EDIT_REJECTED', { editId }, 'Chỉnh sửa tin đăng chưa được duyệt'],
  ['LISTING_EXPIRED', {}, 'Thời hạn đăng tin đã kết thúc'],
  ...statuses.map(status => ['LISTING_STATUS_CHANGED', { status }, {
    PENDING_REVIEW: 'Tin đăng đang chờ xét duyệt', HIDDEN: 'Tin đăng đã bị ẩn',
    VIOLATION: 'Tin đăng bị đánh dấu vi phạm', RENTED_EXTERNALLY: 'Tin đăng đã được ghi nhận đã cho thuê',
  }[status]]),
] as [string, Record<string, string>, string][];
const envelope = (eventType: string, data: unknown) => ({
  eventId: 'listing-event-1', eventType, version: 1,
  occurredAt: '2026-11-13T00:00:00.000Z', recipients: ['owner'], data,
});
const parse = (eventType: string, data: unknown) => parseNotificationEvent(Buffer.from(JSON.stringify(envelope(eventType, data))));

describe('listing notification acceptance', () => {
  it.each(cases)('%s %j: accepts optional title, fixed copy, owner route and minimal metadata', (type, extra, title) => {
    for (const context of [{}, { listingTitle: '  Căn hộ thử nghiệm  ' }, { listingTitle: 'x'.repeat(120) }]) {
      const data = { listingId, ...extra, ...context };
      const parsed = parse(type, data);
      expect(parsed.data).toEqual(data);
      const result = renderNotification(parsed, 'owner');
      expect(result).toMatchObject({ recipientId: 'owner', sourceEventId: 'listing-event-1',
        category: 'LISTING', type, priority: 'NORMAL', title,
        actionPath: `/dashboard/properties/view?id=${listingId}`, metadata: { listingId, ...extra } });
      expect(result.metadata).toEqual({ listingId, ...extra });
      expect(result.body.length).toBeGreaterThan(0);
      expect(isSafeActionPath(result.actionPath)).toBe(true);
      if (typeof context.listingTitle === 'string') expect(result.body).toContain(`Tin: ${context.listingTitle.trim()}.`);
      else expect(result.body).not.toContain('Tin:');
    }
  });

  it.each(cases)('%s rejects missing/invalid identity, private context and inappropriate keys', (type, extra) => {
    const valid = { listingId, ...extra };
    const invalid = [
      { ...extra }, ...['', '../private', 'a/b', 'a?b', '-bad', 'x'.repeat(201), null, 12, [], {}].map(id => ({ ...valid, listingId: id })),
      ...['', '   ', '<private>', 'x>y', 'x\ny', 'x\ty', 'x\u0000y', 'x\u007fy', 'x'.repeat(121), null, 1, [], {}].map(listingTitle => ({ ...valid, listingTitle })),
      ...['reason', 'ownerId', 'recipientSide', 'actionPath', 'url', 'body', 'title', 'unknown', '__proto__'].map(key =>
        JSON.parse(JSON.stringify(valid).slice(0, -1) + `,"${key}":"private"}`)),
      ...(type.startsWith('LISTING_EDIT_') ? [] : [{ ...valid, editId }]),
      ...(type === 'LISTING_STATUS_CHANGED' ? [] : [{ ...valid, status: 'HIDDEN' }]),
    ];
    for (const data of invalid) expect(() => parse(type, data)).toThrow('Invalid notification event');
  });

  it.each(['LISTING_EDIT_APPROVED', 'LISTING_EDIT_REJECTED'])('%s requires an identifier editId', type => {
    for (const editId of [undefined, null, '', 'a/b', 'a?b', 'x'.repeat(201), 1, {}, []]) {
      expect(() => parse(type, { listingId, editId })).toThrow('Invalid notification event');
    }
    expect(parse(type, { listingId, editId: 'x'.repeat(200) }).data.editId).toHaveLength(200);
  });

  it('status changes accept exactly the agreed four values, never prototype keys or other listing states', () => {
    for (const status of [undefined, null, '', 'PUBLISHED', 'REJECTED', 'EXPIRED', 'RENTED', 'RESERVED', 'DRAFT', 'hidden', 'toString', 'constructor', '__proto__', 1, {}, []]) {
      expect(() => parse('LISTING_STATUS_CHANGED', { listingId, status })).toThrow('Invalid notification event');
    }
  });

  it('retains id-only legacy listing events and resource-only contracts', () => {
    for (const type of ['LISTING_APPROVED', 'LISTING_REJECTED']) {
      expect(parse(type, { listingId }).data).toEqual({ listingId });
    }
    for (const [type, key] of [['CONTRACT_SIGNED', 'contractId'], ['PAYMENT_SUCCESSFUL', 'paymentId'], ['CHAT_MESSAGE_RECEIVED', 'conversationId']]) {
      expect(renderNotification(parse(type, { [key]: 'resource-1' }), 'owner')).toMatchObject({ actionPath: '/notifications', metadata: { [key]: 'resource-1' } });
      expect(() => parse(type, { [key]: 'resource-1', listingTitle: 'extra' })).toThrow();
    }
  });

  it('enforces envelope/version/timestamp/recipient limits before rendering listing context', () => {
    const valid = envelope('LISTING_CREATED', { listingId });
    const invalid = [null, [], { ...valid, version: 2 }, { ...valid, extra: 'private' },
      { ...valid, eventType: 'toString' }, { ...valid, eventType: 'LISTING_NEW' }, { ...valid, eventId: '../bad' },
      { ...valid, occurredAt: '2026-11-13T00:00:00Z' }, { ...valid, occurredAt: '2026-02-30T00:00:00.000Z' },
      { ...valid, recipients: [] }, { ...valid, recipients: ['owner', 'owner'] }, { ...valid, recipients: ['bad/user'] },
      { ...valid, recipients: Array.from({ length: 101 }, (_, n) => `user-${n}`) }, { ...valid, data: [] }];
    for (const value of invalid) expect(() => parseNotificationEvent(Buffer.from(JSON.stringify(value)))).toThrow();
    expect(() => parseNotificationEvent(null)).toThrow();
    expect(() => parseNotificationEvent(Buffer.from('{'))).toThrow();
    expect(() => parseNotificationEvent(Buffer.alloc(65537))).toThrow();
    expect(parse('LISTING_CREATED', { listingId: 'x'.repeat(200) }).data.listingId).toHaveLength(200);
  });

  it('describes edit decisions independently from publication and expiry while under review', () => {
    for (const type of ['LISTING_EDIT_APPROVED', 'LISTING_EDIT_REJECTED']) {
      const result = renderNotification(parse(type, { listingId, editId }), 'owner');
      expect(result.body).toContain('chỉnh sửa');
      expect(result.body).not.toMatch(/công khai|đang hiển thị|đã được xuất bản/);
    }
    expect(renderNotification(parse('LISTING_EXPIRED', { listingId }), 'owner').body).toContain('chờ duyệt');
  });

  it('persists distinct decisions once per recipient and emits the same safe view over realtime', async () => {
    const rows = new InMemoryNotificationRepository();
    const emitNew = jest.fn<NotificationRealtimeService['emitNew']>();
    const service = new NotificationService(rows, new InMemoryPreferenceRepository(), undefined,
      { emitNew, emitUnreadCount: jest.fn() } as unknown as NotificationRealtimeService);
    for (const [index, [type, extra]] of cases.entries()) {
      const parsed = parse(type, { listingId, ...extra, listingTitle: 'Private in-app title' });
      parsed.eventId = `decision-${index}`;
      const input = renderNotification(parsed, 'owner');
      const first = await service.create(input);
      const replay = await service.create(input);
      expect(first.created).toBe(true);
      expect(replay.created).toBe(false);
      expect(replay.notification.id).toBe(first.notification.id);
      expect(first.notification).not.toHaveProperty('recipientId');
      expect(first.notification).not.toHaveProperty('sourceEventId');
      expect(emitNew).toHaveBeenLastCalledWith('owner', first.notification);
    }
    expect(rows.rows).toHaveLength(cases.length);
    expect(emitNew).toHaveBeenCalledTimes(cases.length);
    expect((await service.getFeed('owner', { category: 'LISTING', limit: 50 })).items).toHaveLength(cases.length);
    expect((await service.getFeed('stranger', {})).items).toEqual([]);
    await service.create(renderNotification(parse('LISTING_CREATED', { listingId }), 'other-owner'));
    expect((await service.getFeed('other-owner', {})).items).toHaveLength(1);
  });
});
