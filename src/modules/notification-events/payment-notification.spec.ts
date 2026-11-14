import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { parseNotificationEvent, renderNotification } from './notification-event';
import { NotificationEventsConsumer } from './notification-events.consumer';
import { NotificationService } from '../notification/application/notification.service';
import { InMemoryNotificationRepository, InMemoryPreferenceRepository } from '../notification/testing/in-memory-notification.repository';
import { NotificationRealtimeService } from '../notification-realtime/notification-realtime.service';

const types = [
  'PAYMENT_REQUEST_CREATED', 'PAYMENT_TRANSFER_REPORTED', 'PAYMENT_RECEIPT_CONFIRMED', 'PAYMENT_RECEIPT_REJECTED',
  'PAYMENT_DISPUTE_OPENED', 'PAYMENT_DISPUTE_EVIDENCE_ADDED', 'PAYMENT_DISPUTE_PROPOSED',
  'PAYMENT_DISPUTE_PROPOSAL_DECLINED', 'PAYMENT_DISPUTE_ESCALATED', 'PAYMENT_DISPUTE_REVIEW_TRANSFER', 'PAYMENT_DISPUTE_REOPENED',
];
const paymentId = 'cb856b21-5fbf-4d33-b7f7-fd54d5ce7867';
const event = (type = types[0], overrides: Record<string, unknown> = {}) => ({
  eventId: 'payment-event-1', eventType: type, version: 1, occurredAt: '2026-11-14T00:00:00.000Z',
  recipients: ['stored-party'], data: { paymentId }, ...overrides,
});
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const parse = (value: unknown) => parseNotificationEvent(encode(value));

describe('payment and refund notification acceptance', () => {
  it.each(types)('%s has only payment identity and a fixed common route', type => {
    const rendered = renderNotification(parse(event(type)), 'stored-party');
    expect(rendered).toMatchObject({ type, category: 'PAYMENT', priority: 'NORMAL', recipientId: 'stored-party',
      actionPath: `/dashboard/payments?paymentId=${paymentId}`, metadata: { paymentId } });
    expect(rendered.title.length).toBeGreaterThan(0); expect(rendered.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(rendered)).not.toMatch(/VND|ETH|SePay|PRIVATE|storageId|recipientSide|LANDLORD|TENANT/);
  });

  it.each(['amount', 'currency', 'bankAccount', 'transferReference', 'reason', 'fileName', 'storageId', 'ownerId',
    'recipientSide', 'actionPath', 'orderId', '__proto__'])('rejects extra private or routing data %s in every new type', key => {
    const data = JSON.parse(`{"paymentId":"${paymentId}","${key}":"PRIVATE"}`) as unknown;
    for (const type of types) expect(() => parse(event(type, { data }))).toThrow('Invalid notification event');
  });

  it.each([null, '', 3, '../payment', 'a/b', 'a?b', '<script>', 'x'.repeat(201)])('rejects unsafe payment id %j', id => {
    for (const type of types) expect(() => parse(event(type, { data: { paymentId: id } }))).toThrow('Invalid notification event');
  });

  it.each([{ data: {} }, { recipients: [] }, { recipients: ['a', 'b'] }, { recipients: ['a', 'a'] },
    { version: 2 }, { actorId: 'private' }, { data: [] }, { occurredAt: '2026-02-30T00:00:00.000Z' },
    { occurredAt: '2026-11-14T00:00:00Z' }, { eventType: 'PAYMENT_DISPUTE_CONFIRMED' }])('rejects malformed envelope %j', overrides => {
    expect(() => parse(event(types[0], overrides))).toThrow('Invalid notification event');
  });

  it.each(['PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'PAYMENT_OVERDUE'])('preserves old %s route and recipient cardinality', type => {
    const parsed = parse(event(type, { recipients: ['a', 'b'], data: { paymentId: 'payment-legacy' } }));
    expect(renderNotification(parsed, 'a')).toMatchObject({ actionPath: '/notifications', metadata: { paymentId: 'payment-legacy' } });
  });

  it('keeps membership and payment identity contracts separate', () => {
    const membership = renderNotification(parse(event('MEMBERSHIP_ACTIVATED', { data: { orderId: 'order-1' } })), 'stored-party');
    expect(membership.actionPath).toBe('/dashboard/membership/return?orderId=order-1');
    expect(() => parse(event(types[0], { data: { orderId: 'order-1' } }))).toThrow();
    expect(() => parse(event('MEMBERSHIP_ACTIVATED'))).toThrow();
  });

  it('does not describe reported transfers or routed disputes as completed receipts', () => {
    for (const type of ['PAYMENT_TRANSFER_REPORTED', 'PAYMENT_DISPUTE_REVIEW_TRANSFER', 'PAYMENT_DISPUTE_REOPENED']) {
      const item = renderNotification(parse(event(type)), 'stored-party');
      expect(item.body).toMatch(/chưa/); expect(item.title).not.toMatch(/thành công|đã được xác nhận nhận tiền/);
    }
    expect(renderNotification(parse(event('PAYMENT_REQUEST_CREATED')), 'stored-party').body).not.toMatch(/ngay|còn \d|trước ngày/);
  });

  it('keeps each real outcome, deduplicates replay, and scopes feed and mutations to the recipient', async () => {
    const emitNew = jest.fn<NotificationRealtimeService['emitNew']>();
    const service = new NotificationService(new InMemoryNotificationRepository(), new InMemoryPreferenceRepository(), undefined,
      { emitNew, emitUnreadCount: jest.fn() } as unknown as NotificationRealtimeService);
    const ids: string[] = [];
    for (const [i, type] of types.entries()) {
      const item = renderNotification(parse(event(type, { eventId: `transition-${i}` })), 'stored-party');
      const first = await service.create(item); ids.push(first.notification.id);
      expect((await service.create(item)).created).toBe(false);
      await expect(service.markRead('outsider', first.notification.id)).rejects.toThrow();
      await expect(service.delete('outsider', first.notification.id)).rejects.toThrow();
    }
    expect(new Set(ids).size).toBe(types.length); expect(emitNew).toHaveBeenCalledTimes(types.length);
    expect((await service.getFeed('stored-party', { category: 'PAYMENT' })).items).toHaveLength(types.length);
    expect((await service.getFeed('outsider', {})).items).toEqual([]);
    await service.updatePreferences('stored-party', [{ category: 'PAYMENT', push: false, email: false }]);
    expect((await service.getFeed('stored-party', {})).items).toHaveLength(types.length);
  });

  const consumer = () => {
    const create = jest.fn<NotificationService['create']>().mockResolvedValue({} as never);
    const send = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    const commitOffsets = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    const service = new NotificationEventsConsumer(new ConfigService({ KAFKA_RETRY_ATTEMPTS: 1,
      KAFKA_RETRY_DELAY_MS: 0, KAFKA_DLT_TOPIC: 'payment-test-dlt' }), { create } as unknown as NotificationService);
    Object.assign(service, { consumer: { commitOffsets }, producer: { send } });
    const payload = (value: unknown): Parameters<typeof service.consume>[0] => ({ topic: 'payment-test', partition: 0,
      message: { offset: '9007199254740993', value: encode(value) }, heartbeat: async () => {},
    } as Parameters<typeof service.consume>[0]);
    return { create, send, commitOffsets, service, payload };
  };

  it.each(types)('persists %s before exact offset acknowledgment', async type => {
    const x = consumer(); await x.service.consume(x.payload(event(type)));
    expect(x.create).toHaveBeenCalledWith(expect.objectContaining({ type, recipientId: 'stored-party', metadata: { paymentId } }));
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledWith([{ topic: 'payment-test', partition: 0, offset: '9007199254740994' }]);
    expect(x.create.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });

  it('quarantines rejected financial payload without echoing content and waits for DLT acknowledgment', async () => {
    const x = consumer(); await x.service.consume(x.payload(event(types[0], { data: { paymentId, reason: 'PRIVATE_BANK_REASON' } })));
    expect(x.create).not.toHaveBeenCalled(); expect(x.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(x.send.mock.calls)).not.toMatch(/PRIVATE_BANK_REASON|stored-party|cb856b21/);
    expect(x.send.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });

  it('does not acknowledge a valid event when persistence fails', async () => {
    const x = consumer(); x.create.mockRejectedValue(new Error('database unavailable'));
    await expect(x.service.consume(x.payload(event()))).rejects.toThrow('Notification persistence unavailable');
    expect(x.commitOffsets).not.toHaveBeenCalled(); expect(x.send).not.toHaveBeenCalled();
  });

  it('does not acknowledge an invalid event if DLT fails', async () => {
    const x = consumer(); x.send.mockRejectedValue(new Error('DLT unavailable'));
    await expect(x.service.consume(x.payload(event(types[0], { data: {} })))).rejects.toThrow();
    expect(x.create).not.toHaveBeenCalled(); expect(x.commitOffsets).not.toHaveBeenCalled();
  });
});
