import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { parseNotificationEvent, renderNotification } from './notification-event';
import { NotificationEventsConsumer } from './notification-events.consumer';
import { NotificationService } from '../notification/application/notification.service';

const recordTypes = ['MOVE_IN_HANDOVER_PROPOSED', 'MOVE_IN_HANDOVER_CONFIRMED', 'MOVE_IN_HANDOVER_COMPLETED', 'MOVE_IN_HANDOVER_DISPUTED'];
const types = [...recordTypes, 'MOVE_IN_HANDOVER_READY'];
const contractId = '0f1e2d3c-4b5a-4968-8776-655443322110';
const event = (type = types[0], overrides: Record<string, unknown> = {}) => ({
  eventId: 'handover-event-1', eventType: type, version: 1, occurredAt: '2026-11-14T00:00:00.000Z',
  recipients: ['stored-party'], data: { contractId }, ...overrides,
});
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const parse = (value: unknown) => parseNotificationEvent(encode(value));
const route = `/dashboard/invoices/${contractId}?section=deposit&workflow=move-in`;

describe('move-in handover notification acceptance', () => {
  it.each(types)('%s parses and renders CONTRACT/NORMAL with only the root lease id and the fixed deposit route', type => {
    const rendered = renderNotification(parse(event(type)), 'stored-party');
    expect(rendered).toMatchObject({ type, category: 'CONTRACT', priority: 'NORMAL', recipientId: 'stored-party',
      sourceEventId: 'handover-event-1', actionPath: route, metadata: { contractId } });
    expect(Object.keys(rendered.metadata ?? {})).toEqual(['contractId']);
    expect(rendered.title.length).toBeGreaterThan(0); expect(rendered.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(rendered)).not.toMatch(/VND|\d{2}\/\d{2}|PRIVATE|recipientSide|LANDLORD|TENANT|revision|section=monthly/);
  });

  it('encodes the id in the route using the allowed identifier set', () => {
    expect(renderNotification(parse(event(types[0], { data: { contractId: 'a_b-1' } })), 'p').actionPath)
      .toBe('/dashboard/invoices/a_b-1?section=deposit&workflow=move-in');
  });

  it.each(['invoiceId', 'handoverId', 'revision', 'role', 'amount', 'note', 'reason', 'actorId', 'recipientSide', 'actionPath', 'paymentId', '__proto__'])(
    'rejects extra private or routing data %s in every type', key => {
      const data = JSON.parse(`{"contractId":"${contractId}","${key}":"PRIVATE"}`) as unknown;
      for (const type of types) expect(() => parse(event(type, { data }))).toThrow('Invalid notification event');
    });

  it.each([{}, { contractId: undefined }, { id: contractId }, { invoiceId: contractId }, { contractId, invoiceId: contractId }])(
    'rejects missing, renamed or additional identity keys %j', data => {
      for (const type of types) expect(() => parse(event(type, { data }))).toThrow('Invalid notification event');
    });

  it.each([null, '', 3, '../x', 'a/b', 'a?b', '<script>', 'x'.repeat(201), ' a', 'a b'])('rejects unsafe contract id %j', id => {
    for (const type of types) expect(() => parse(event(type, { data: { contractId: id } }))).toThrow('Invalid notification event');
  });

  it.each([{ recipients: [] }, { recipients: ['a', 'b'] }, { recipients: ['a', 'a'] }, { version: 2 }, { actorId: 'private' },
    { data: [] }, { data: null }, { occurredAt: '2026-11-14T00:00:00Z' }, { eventType: 'MOVE_IN_HANDOVER_REJECTED' },
    { eventType: 'move_in_handover_proposed' }])('rejects malformed envelope %j', overrides => {
    expect(() => parse(event(types[0], overrides))).toThrow('Invalid notification event');
  });

  it('rejects an unknown envelope property and a multi-recipient fan-out for every type', () => {
    for (const type of types) {
      expect(() => parse(event(type, { extra: 1 }))).toThrow('Invalid notification event');
      expect(() => parse(event(type, { recipients: ['a', 'b'] }))).toThrow('Invalid notification event');
    }
  });

  it('keeps legacy contract, invoice, payment and membership contracts unaffected', () => {
    const legacy = renderNotification(parse(event('CONTRACT_SIGNED', { recipients: ['a', 'b'], data: { contractId: 'legacy-1' } })), 'a');
    expect(legacy.category).toBe('CONTRACT');
    expect(legacy.actionPath).not.toMatch(/section=deposit/);
    expect(renderNotification(parse(event('INVOICE_ISSUED', { data: { contractId, invoiceId: 'inv-1' } })), 'p').actionPath)
      .toBe(`/dashboard/invoices/${contractId}?section=monthly&invoice=inv-1`);
    expect(parse(event('MEMBERSHIP_ACTIVATED', { data: { orderId: 'order-1' } })).eventType).toBe('MEMBERSHIP_ACTIVATED');
    // Handover identity never satisfies other shapes, and other identity never satisfies handover.
    expect(() => parse(event('INVOICE_ISSUED', { data: { contractId } }))).toThrow();
    expect(() => parse(event('PAYMENT_REQUEST_CREATED', { data: { contractId } }))).toThrow();
    expect(() => parse(event(types[0], { data: { contractId, invoiceId: 'inv-1' } }))).toThrow();
    expect(() => parse(event(types[0], { data: { orderId: 'order-1' } }))).toThrow();
  });

  it('keeps neutral copy tied to the current record without promising pending state or money', () => {
    const copy = (type: string) => { const r = renderNotification(parse(event(type)), 'p'); return `${r.title} ${r.body}`; };
    for (const type of recordTypes) {
      expect(copy(type)).toMatch(/biên bản/); expect(copy(type)).not.toMatch(/\d|khiếu nại|đã nhận tiền(?!\.)/);
    }
    expect(copy('MOVE_IN_HANDOVER_PROPOSED')).toMatch(/lập hoặc cập nhật/);
    expect(copy('MOVE_IN_HANDOVER_CONFIRMED')).toMatch(/Một bên đã xác nhận/);
    expect(copy('MOVE_IN_HANDOVER_CONFIRMED')).not.toMatch(/chờ|đang đợi|còn thiếu/);
    expect(copy('MOVE_IN_HANDOVER_COMPLETED')).toMatch(/Hai bên đã xác nhận/);
    expect(copy('MOVE_IN_HANDOVER_COMPLETED')).toMatch(/không phải xác nhận đã nhận tiền/);
    expect(copy('MOVE_IN_HANDOVER_DISPUTED')).toMatch(/báo vấn đề về biên bản/);
    expect(copy('MOVE_IN_HANDOVER_DISPUTED')).not.toMatch(/giải quyết|đã xử lý/);
  });

  it('READY copy says the signed lease is available without claiming a handover record or proposal exists', () => {
    const r = renderNotification(parse(event('MOVE_IN_HANDOVER_READY')), 'p'); const text = `${r.title} ${r.body}`;
    expect(text).toMatch(/Hợp đồng thuê đã ký/); expect(text).toMatch(/Chủ nhà có thể xem hoặc ghi nhận/);
    expect(text).not.toMatch(/biên bản|đề xuất|đã lập|\d|tiền/);
  });

  const consumer = () => {
    const create = jest.fn<NotificationService['create']>().mockResolvedValue({} as never);
    const send = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    const commitOffsets = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    const service = new NotificationEventsConsumer(new ConfigService({ KAFKA_RETRY_ATTEMPTS: 1,
      KAFKA_RETRY_DELAY_MS: 0, KAFKA_DLT_TOPIC: 'handover-test-dlt' }), { create } as unknown as NotificationService);
    Object.assign(service, { consumer: { commitOffsets }, producer: { send } });
    const payload = (value: unknown): Parameters<typeof service.consume>[0] => ({ topic: 'handover-test', partition: 0,
      message: { offset: '41', value: encode(value) }, heartbeat: async () => {},
    } as Parameters<typeof service.consume>[0]);
    return { create, send, commitOffsets, service, payload };
  };

  it.each(types)('persists %s before offset acknowledgment', async type => {
    const x = consumer(); await x.service.consume(x.payload(event(type)));
    expect(x.create).toHaveBeenCalledWith(expect.objectContaining({ type, recipientId: 'stored-party', metadata: { contractId } }));
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledWith([{ topic: 'handover-test', partition: 0, offset: '42' }]);
    expect(x.create.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });

  it('quarantines a rejected handover payload to the redacted DLT before committing', async () => {
    const x = consumer(); await x.service.consume(x.payload(event(types[0], { data: { contractId, note: 'PRIVATE_NOTE' } })));
    expect(x.create).not.toHaveBeenCalled(); expect(x.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(x.send.mock.calls)).not.toMatch(/PRIVATE_NOTE|stored-party|0f1e2d3c/);
    expect(x.send.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });
});
