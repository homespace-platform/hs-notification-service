import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { parseNotificationEvent, renderNotification } from './notification-event';
import { NotificationEventsConsumer } from './notification-events.consumer';
import { NotificationService } from '../notification/application/notification.service';
import { InMemoryNotificationRepository, InMemoryPreferenceRepository } from '../notification/testing/in-memory-notification.repository';
import { NotificationRealtimeService } from '../notification-realtime/notification-realtime.service';

const types = ['ACCOUNT_ROLE_CHANGED', 'ACCOUNT_DISABLED', 'ACCOUNT_ENABLED'];
const event = (type = types[0], overrides: Record<string, unknown> = {}) => ({
  eventId: 'account-transition-1', eventType: type, version: 1, occurredAt: '2026-11-13T12:00:00.000Z',
  recipients: ['affected-user'], data: {}, ...overrides,
});
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('account notifications: strict contract and delivery boundaries', () => {
  it.each(types)('%s has one recipient, no producer data and a fixed own-account link', type => {
    const parsed = parseNotificationEvent(encode(event(type)));
    const notice = renderNotification(parsed, parsed.recipients[0]);
    expect(notice).toMatchObject({ recipientId: 'affected-user', sourceEventId: 'account-transition-1',
      category: 'ACCOUNT', type, priority: 'NORMAL', actionPath: '/settings/account-security' });
    expect(notice.metadata).toBeUndefined();
    expect(notice.title.length).toBeGreaterThan(5); expect(notice.body.length).toBeGreaterThan(10);
    expect(notice.body).not.toMatch(/ADMIN|RENTER|OWNER|@|roleId|quản trị viên/);
  });

  it.each(['accountId', 'actorId', 'email', 'role', 'roles', 'permissions', 'reason', 'status', 'enabled',
    'actionPath', 'url', 'listingId', '__proto__'])('rejects forbidden data field %s for every account type', field => {
    for (const type of types) {
      const data = JSON.parse(`{"${field}":"private-payload"}`) as Record<string, string>;
      expect(() => parseNotificationEvent(encode(event(type, { data })))).toThrow('Invalid notification event');
    }
  });

  it.each([null, [], '', 1, true])('rejects nonobject data %j', data => {
    expect(() => parseNotificationEvent(encode(event(types[0], { data })))).toThrow('Invalid notification event');
  });

  it.each([
    { recipients: [] }, { recipients: ['a', 'b'] }, { recipients: ['a', 'a'] },
    { recipients: ['../admin'] }, { recipients: [''] }, { version: 2 },
    { occurredAt: '2026-02-30T00:00:00.000Z' }, { occurredAt: '2026-11-13T12:00:00Z' },
    { eventId: '' }, { extra: 'unsafe' }, { eventType: 'constructor' }, { eventType: '__proto__' },
  ])('rejects malformed envelope %j', overrides => {
    expect(() => parseNotificationEvent(encode(event(types[0], overrides)))).toThrow('Invalid notification event');
  });

  it('does not relax old resource event requirements', () => {
    for (const type of ['LISTING_APPROVED', 'BOOKING_REQUESTED', 'RENTAL_REQUEST_SUBMITTED',
      'PAYMENT_SUCCESSFUL', 'CONTRACT_SIGNED', 'CHAT_MESSAGE_RECEIVED']) {
      expect(() => parseNotificationEvent(encode(event(type)))).toThrow('Invalid notification event');
    }
  });

  it('disable -> enable -> disable persists three transitions, dedups replay, and isolates feed/read/delete', async () => {
    const emitNew = jest.fn<NotificationRealtimeService['emitNew']>();
    const service = new NotificationService(new InMemoryNotificationRepository(), new InMemoryPreferenceRepository(),
      undefined, { emitNew, emitUnreadCount: jest.fn() } as unknown as NotificationRealtimeService);
    const ids: string[] = [];
    for (const [i, type] of ['ACCOUNT_DISABLED', 'ACCOUNT_ENABLED', 'ACCOUNT_DISABLED'].entries()) {
      const input = renderNotification(parseNotificationEvent(encode(event(type, { eventId: `account-${i}` }))), 'affected-user');
      const first = await service.create(input); ids.push(first.notification.id);
      expect((await service.create(input)).created).toBe(false);
      expect(first.notification).not.toHaveProperty('recipientId');
      expect(first.notification.metadata).toBeNull();
    }
    expect(new Set(ids).size).toBe(3); expect(emitNew).toHaveBeenCalledTimes(3);
    expect((await service.getFeed('affected-user', { category: 'ACCOUNT' })).items).toHaveLength(3);
    expect((await service.getFeed('other-user', {})).items).toEqual([]);
    await expect(service.markRead('other-user', ids[0])).rejects.toThrow();
    await expect(service.delete('other-user', ids[0])).rejects.toThrow();
    expect(emitNew.mock.calls.every(call => call[0] === 'affected-user')).toBe(true);
    await service.updatePreferences('affected-user', [{ category: 'ACCOUNT', push: false, email: false }]);
    expect((await service.getPreferences('affected-user')).find(p => p.category === 'ACCOUNT')?.push).toBe(false);
    expect((await service.getFeed('affected-user', {})).items).toHaveLength(3);
  });

  const consumer = () => {
    const create = jest.fn<NotificationService['create']>().mockResolvedValue({} as never);
    const send = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    const commitOffsets = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    const service = new NotificationEventsConsumer(new ConfigService({ KAFKA_RETRY_ATTEMPTS: 1,
      KAFKA_RETRY_DELAY_MS: 0, KAFKA_DLT_TOPIC: 'account-test-dlt' }), { create } as unknown as NotificationService);
    Object.assign(service, { consumer: { commitOffsets }, producer: { send } });
    const payload = (value: unknown): Parameters<typeof service.consume>[0] => ({
      topic: 'account-test', partition: 0,
      message: { offset: '9007199254740993', value: encode(value) }, heartbeat: async () => {},
    } as Parameters<typeof service.consume>[0]);
    return { create, send, commitOffsets, service, payload };
  };

  it('persists a valid account notification before committing the exact source offset', async () => {
    const x = consumer(); await x.service.consume(x.payload(event()));
    expect(x.create).toHaveBeenCalledWith(expect.objectContaining({ category: 'ACCOUNT', recipientId: 'affected-user' }));
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledWith([{ topic: 'account-test', partition: 0, offset: '9007199254740994' }]);
    expect(x.create.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });

  it('quarantines private data without echoing it and only commits after DLT ack', async () => {
    const x = consumer(); await x.service.consume(x.payload(event(types[0], { data: { role: 'PRIVATE_ROLE', email: 'private@secret.test' } })));
    expect(x.create).not.toHaveBeenCalled(); expect(x.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(x.send.mock.calls)).not.toMatch(/PRIVATE_ROLE|private@secret/);
    expect(JSON.stringify(x.send.mock.calls)).toContain('INVALID_EVENT');
    expect(x.send.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });

  it('does not acknowledge a valid transition when persistence fails', async () => {
    const x = consumer(); x.create.mockRejectedValue(new Error('test database unavailable'));
    await expect(x.service.consume(x.payload(event()))).rejects.toThrow('Notification persistence unavailable');
    expect(x.commitOffsets).not.toHaveBeenCalled(); expect(x.send).not.toHaveBeenCalled();
  });
});
