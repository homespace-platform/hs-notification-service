import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { parseNotificationEvent, renderNotification } from './notification-event';
import { NotificationEventsConsumer } from './notification-events.consumer';
import { NotificationService } from '../notification/application/notification.service';
import { InMemoryNotificationRepository, InMemoryPreferenceRepository } from '../notification/testing/in-memory-notification.repository';
import { NotificationRealtimeService } from '../notification-realtime/notification-realtime.service';

const types = [
  'INVOICE_DRAFT_READY', 'INVOICE_ISSUED', 'INVOICE_OVERDUE', 'INVOICE_AMOUNT_UPDATED', 'INVOICE_EXTENSION_REQUESTED',
  'INVOICE_EXTENSION_APPROVED', 'INVOICE_EXTENSION_REJECTED', 'INVOICE_EXTENSION_EXPIRED', 'INVOICE_OVERDUE_ACTION_RECORDED',
  'INVOICE_OVERDUE_ACTION_ACKNOWLEDGED', 'INVOICE_DEFERRED', 'INVOICE_ROLLED_OVER', 'INVOICE_OVERDUE_ACTION_REQUIRED',
];
const contractId = '0f1e2d3c-4b5a-4968-8776-655443322110';
const invoiceId = 'cb856b21-5fbf-4d33-b7f7-fd54d5ce7867';
const paymentId = invoiceId;
const event = (type = types[0], overrides: Record<string, unknown> = {}) => ({
  eventId: 'invoice-event-1', eventType: type, version: 1, occurredAt: '2026-11-14T00:00:00.000Z',
  recipients: ['stored-party'], data: { contractId, invoiceId }, ...overrides,
});
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const parse = (value: unknown) => parseNotificationEvent(encode(value));
const route = `/dashboard/invoices/${contractId}?section=monthly&invoice=${invoiceId}`;

describe('monthly invoice notification acceptance', () => {
  it('covers exactly the 13 frozen types', () => {
    expect(new Set(types).size).toBe(13);
  });

  it.each(types)('%s has only contract/invoice identity and one fixed invoice route', type => {
    const rendered = renderNotification(parse(event(type)), 'stored-party');
    expect(rendered).toMatchObject({ type, category: 'PAYMENT', priority: 'NORMAL', recipientId: 'stored-party',
      actionPath: route, metadata: { contractId, invoiceId } });
    expect(Object.keys(rendered.metadata ?? {}).sort()).toEqual(['contractId', 'invoiceId']);
    expect(rendered.title.length).toBeGreaterThan(0); expect(rendered.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(rendered)).not.toMatch(/VND|\d{2}\/\d{2}|kWh|SePay|PRIVATE|recipientSide|LANDLORD|TENANT/);
  });

  it('encodes ids in the route', () => {
    // identifier() forbids unsafe characters, so encoding is exercised through the allowed set only (no change expected).
    const parsed = parse(event(types[0], { data: { contractId: 'a_b-1', invoiceId: 'Z9' } }));
    expect(renderNotification(parsed, 'stored-party').actionPath).toBe('/dashboard/invoices/a_b-1?section=monthly&invoice=Z9');
  });

  it.each(['amount', 'lateFee', 'dueDate', 'meterReading', 'reason', 'note', 'tenantName', 'status', 'paymentId',
    'recipientSide', 'actionPath', 'orderId', '__proto__'])('rejects extra private or routing data %s in every type', key => {
    const data = JSON.parse(`{"contractId":"${contractId}","invoiceId":"${invoiceId}","${key}":"PRIVATE"}`) as unknown;
    for (const type of types) expect(() => parse(event(type, { data }))).toThrow('Invalid notification event');
  });

  it.each([{ contractId }, { invoiceId }, { contractId, invoiceId: undefined }, { invoiceId, paymentId: invoiceId }, {}])(
    'rejects missing or renamed identity keys %j', data => {
      for (const type of types) expect(() => parse(event(type, { data }))).toThrow('Invalid notification event');
    });

  it.each([null, '', 3, '../x', 'a/b', 'a?b', '<script>', 'x'.repeat(201), `first-rent:${invoiceId}`, ' a', 'a b'])(
    'rejects unsafe or synthetic id %j in either field', id => {
      for (const type of types) {
        expect(() => parse(event(type, { data: { contractId: id, invoiceId } }))).toThrow('Invalid notification event');
        expect(() => parse(event(type, { data: { contractId, invoiceId: id } }))).toThrow('Invalid notification event');
      }
    });

  it.each([{ recipients: [] }, { recipients: ['a', 'b'] }, { recipients: ['a', 'a'] },
    { version: 2 }, { actorId: 'private' }, { data: [] }, { data: null }, { occurredAt: '2026-02-30T00:00:00.000Z' },
    { occurredAt: '2026-11-14T00:00:00Z' }, { occurredAt: '2026-11-14' }, { eventType: 'INVOICE_PAID' },
    { eventType: 'INVOICE_TERMINATION_NOTICE' }, { eventType: 'invoice_issued' }])('rejects malformed envelope %j', overrides => {
    expect(() => parse(event(types[0], overrides))).toThrow('Invalid notification event');
  });

  it('rejects an unknown envelope property for every type', () => {
    for (const type of types) expect(() => parse(event(type, { extra: 1 }))).toThrow('Invalid notification event');
  });

  it('keeps old payment, membership and listing contracts unaffected', () => {
    const legacy = parse(event('PAYMENT_OVERDUE', { recipients: ['a', 'b'], data: { paymentId: 'payment-legacy' } }));
    expect(renderNotification(legacy, 'a')).toMatchObject({ actionPath: '/notifications', metadata: { paymentId: 'payment-legacy' } });
    const membership = renderNotification(parse(event('MEMBERSHIP_ACTIVATED', { data: { orderId: 'order-1' } })), 'stored-party');
    expect(membership.actionPath).toBe('/dashboard/membership/return?orderId=order-1');
    const phase3 = renderNotification(parse(event('PAYMENT_REQUEST_CREATED', { data: { paymentId } })), 'stored-party');
    expect(phase3.actionPath).toBe(`/dashboard/payments?paymentId=${paymentId}`);
    // Invoice identity never satisfies the old shapes, and old identity never satisfies invoice types.
    expect(() => parse(event('PAYMENT_OVERDUE', { data: { contractId, invoiceId } }))).toThrow();
    expect(() => parse(event('PAYMENT_REQUEST_CREATED', { data: { contractId, invoiceId } }))).toThrow();
    expect(() => parse(event(types[0], { data: { paymentId } }))).toThrow();
    expect(() => parse(event('MEMBERSHIP_ACTIVATED', { data: { contractId, invoiceId } }))).toThrow();
    expect(parse(event('LISTING_APPROVED', { data: { listingId: 'l1' } })).eventType).toBe('LISTING_APPROVED');
  });

  it('keeps copy tied to the actual outcome without promising status, money or lease results', () => {
    const body = (type: string) => renderNotification(parse(event(type)), 'stored-party').body;
    for (const type of types) expect(body(type)).toMatch(/hóa đơn/);
    expect(body('INVOICE_DRAFT_READY')).toMatch(/kiểm tra/); expect(body('INVOICE_DRAFT_READY')).not.toMatch(/bản nháp|còn là/);
    expect(body('INVOICE_ISSUED')).toMatch(/trạng thái hiện tại/); expect(body('INVOICE_ISSUED')).not.toMatch(/thanh toán ngay|còn \d|thành công/);
    expect(body('INVOICE_OVERDUE')).not.toMatch(/chấm dứt|hủy hợp đồng/);
    expect(body('INVOICE_AMOUNT_UPDATED')).toMatch(/kiểm tra trước khi chuyển khoản/);
    for (const type of ['INVOICE_EXTENSION_REQUESTED', 'INVOICE_EXTENSION_APPROVED', 'INVOICE_EXTENSION_REJECTED', 'INVOICE_EXTENSION_EXPIRED'])
      expect(body(type)).not.toMatch(/\d|tự động chấp nhận/);
    expect(body('INVOICE_OVERDUE_ACTION_RECORDED')).not.toMatch(/chấm dứt|chấp nhận đề xuất/);
    expect(body('INVOICE_OVERDUE_ACTION_ACKNOWLEDGED')).not.toMatch(/đồng ý|chấp nhận/);
    expect(body('INVOICE_DEFERRED')).toMatch(/quyết định/); expect(body('INVOICE_DEFERRED')).not.toMatch(/đã được chuyển|đã thanh toán|hủy/);
    expect(body('INVOICE_ROLLED_OVER')).toMatch(/đã được chuyển sang hóa đơn khác.*đã được hủy/);
    expect(body('INVOICE_ROLLED_OVER')).not.toMatch(/miễn|đã thanh toán|xóa nợ/);
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
    // Per-recipient dedup: the same envelope id reaches the other party as its own row.
    const other = await service.create(renderNotification(parse(event('INVOICE_OVERDUE', { eventId: 'transition-2', recipients: ['other-party'] })), 'other-party'));
    expect(other.created).toBe(true);
    expect(new Set(ids).size).toBe(types.length); expect(emitNew).toHaveBeenCalledTimes(types.length + 1);
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
      KAFKA_RETRY_DELAY_MS: 0, KAFKA_DLT_TOPIC: 'invoice-test-dlt' }), { create } as unknown as NotificationService);
    Object.assign(service, { consumer: { commitOffsets }, producer: { send } });
    const payload = (value: unknown): Parameters<typeof service.consume>[0] => ({ topic: 'invoice-test', partition: 0,
      message: { offset: '9007199254740993', value: encode(value) }, heartbeat: async () => {},
    } as Parameters<typeof service.consume>[0]);
    return { create, send, commitOffsets, service, payload };
  };

  it.each(types)('persists %s before exact offset acknowledgment', async type => {
    const x = consumer(); await x.service.consume(x.payload(event(type)));
    expect(x.create).toHaveBeenCalledTimes(1);
    expect(x.create).toHaveBeenCalledWith(expect.objectContaining({ type, recipientId: 'stored-party', metadata: { contractId, invoiceId } }));
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledWith([{ topic: 'invoice-test', partition: 0, offset: '9007199254740994' }]);
    expect(x.create.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });

  it('quarantines a rejected invoice payload without echoing content and waits for DLT acknowledgment', async () => {
    const x = consumer(); await x.service.consume(x.payload(event(types[0], { data: { contractId, invoiceId, reason: 'PRIVATE_NOTE' } })));
    expect(x.create).not.toHaveBeenCalled(); expect(x.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(x.send.mock.calls)).not.toMatch(/PRIVATE_NOTE|stored-party|cb856b21|0f1e2d3c/);
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
