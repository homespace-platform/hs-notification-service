import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { parseNotificationEvent, renderNotification } from './notification-event';
import { NotificationEventsConsumer } from './notification-events.consumer';
import { NotificationService } from '../notification/application/notification.service';

const rootTypes = ['LEASE_RETURN_CONFIRMED', 'LEASE_RETURN_COMPLETED', 'SETTLEMENT_RESPONSE_NEEDED',
  'SETTLEMENT_DISPUTED', 'SETTLEMENT_PROPOSAL_INVALIDATED', 'SETTLEMENT_AGREED',
  'SETTLEMENT_RESPONSE_OVERDUE', 'SETTLEMENT_PAYMENT_OVERDUE', 'LEASE_CLOSED'];
const paymentType = 'PAYMENT_OBLIGATION_OVERDUE';
const types = [...rootTypes, paymentType];
const resourceId = '0f1e2d3c-4b5a-4968-8776-655443322110';
const dataFor = (type: string, id = resourceId) => type === paymentType ? { paymentId: id } : { contractId: id };
const routeFor = (type: string, id = resourceId) => type === paymentType
  ? `/dashboard/payments?paymentId=${encodeURIComponent(id)}`
  : ['LEASE_RETURN_CONFIRMED', 'LEASE_RETURN_COMPLETED'].includes(type)
    ? `/dashboard/contracts/${encodeURIComponent(id)}`
    : `/dashboard/invoices/${encodeURIComponent(id)}?section=deposit`;
const event = (type: string, overrides: Record<string, unknown> = {}) => ({
  eventId: 'return-settlement-event-1', eventType: type, version: 1, occurredAt: '2026-11-14T00:00:00.000Z',
  recipients: ['stored-party'], data: dataFor(type), ...overrides,
});
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const parse = (value: unknown) => parseNotificationEvent(encode(value));
const rendered = (type: string) => renderNotification(parse(event(type)), 'stored-party');

describe('return, settlement and obligation deadline contract', () => {
  it.each(types)('%s has exact identity, category and fixed authorized route', type => {
    const result = rendered(type);
    expect(result).toMatchObject({ type, category: type === paymentType ? 'PAYMENT' : 'CONTRACT', priority: 'NORMAL',
      recipientId: 'stored-party', sourceEventId: 'return-settlement-event-1',
      actionPath: routeFor(type), metadata: dataFor(type) });
    expect(Object.keys(result.metadata ?? {})).toEqual([type === paymentType ? 'paymentId' : 'contractId']);
    expect(result.title.length).toBeGreaterThan(0); expect(result.body.length).toBeGreaterThan(0);
    expect(`${result.title} ${result.body}`).not.toMatch(/VND|ETH|PRIVATE|\d|LANDLORD|TENANT|https?:/);
    expect(renderNotification(parse(event(type, { data: dataFor(type, 'A_b-1') })), 'stored-party').actionPath)
      .toBe(routeFor(type, 'A_b-1'));
  });

  it.each(['amount', 'status', 'reason', 'note', 'deadline', 'date', 'side', 'recipientSide', 'actorId',
    'proposalVersion', 'revision', 'evidenceId', 'bankAccount', 'signature', 'url', 'actionPath', '__proto__'])(
    'rejects private or routing field %s for every type', key => {
      for (const type of types) {
        const data = JSON.parse(`{"${type === paymentType ? 'paymentId' : 'contractId'}":"${resourceId}","${key}":"PRIVATE"}`) as unknown;
        expect(() => parse(event(type, { data }))).toThrow('Invalid notification event');
      }
    });

  it.each([null, '', 3, '../x', 'a/b', 'a?b', 'a#b', '<script>', ' a', 'a b', 'x'.repeat(201)])(
    'rejects unsafe identity %j for every type', id => {
      for (const type of types) expect(() => parse(event(type,
        { data: { [type === paymentType ? 'paymentId' : 'contractId']: id } }))).toThrow('Invalid notification event');
    });

  it.each([{}, null, [], { agreementId: resourceId }, { invoiceId: resourceId },
    { contractId: resourceId, paymentId: resourceId }])('rejects missing, mixed or renamed identity %j', data => {
    for (const type of types) expect(() => parse(event(type, { data }))).toThrow('Invalid notification event');
  });

  it('keeps root and payment identities separate and accepts the identifier length boundary', () => {
    for (const type of rootTypes) expect(() => parse(event(type, { data: { paymentId: resourceId } }))).toThrow();
    expect(() => parse(event(paymentType, { data: { contractId: resourceId } }))).toThrow();
    for (const type of types) expect(parse(event(type, { data: dataFor(type, 'x'.repeat(200)) })).eventType).toBe(type);
  });

  it.each([{ recipients: [] }, { recipients: ['a', 'b'] }, { recipients: ['a', 'a'] }, { recipients: [null] },
    { version: 2 }, { actorId: 'PRIVATE' }, { occurredAt: '2026-02-30T00:00:00.000Z' },
    { occurredAt: '2026-11-14T00:00:00Z' }, { eventType: 'LEASE_RETURNED' },
    { eventType: 'SETTLEMENT_APPROVED' }, { eventType: 'payment_obligation_overdue' }])(
    'rejects invalid cardinality or envelope %j for every type', overrides => {
      for (const type of types) expect(() => parse(event(type, overrides))).toThrow('Invalid notification event');
    });

  it.each([
    ['CONTRACT_SIGNED', { contractId: resourceId }, '/notifications'],
    ['PAYMENT_OVERDUE', { paymentId: resourceId }, '/notifications'],
  ])('preserves legacy %s fanout and route', (type, data, path) => {
    const old = parse(event(type as string, { recipients: ['a', 'b'], data }));
    expect(renderNotification(old, 'a')).toMatchObject({ actionPath: path, metadata: data });
  });

  it.each([
    ['PAYMENT_REQUEST_CREATED', { paymentId: resourceId }, `/dashboard/payments?paymentId=${resourceId}`],
    ['INVOICE_ISSUED', { contractId: resourceId, invoiceId: 'bill-1' }, `/dashboard/invoices/${resourceId}?section=monthly&invoice=bill-1`],
    ['TERMINATION_ENDED', { contractId: resourceId }, `/dashboard/contracts/${resourceId}`],
    ['LEASE_EXPIRED', { contractId: resourceId }, `/dashboard/contracts/${resourceId}`],
    ['MOVE_IN_HANDOVER_READY', { contractId: resourceId }, `/dashboard/invoices/${resourceId}?section=deposit&workflow=move-in`],
    ['AGREEMENT_FULLY_SIGNED', { agreementId: 'exact-child', agreementKind: 'EARLY_EXIT' }, '/dashboard/contracts/exact-child'],
  ])('preserves previous family %s identity and route', (type, data, path) => {
    expect(renderNotification(parse(event(type as string, { data })), 'stored-party'))
      .toMatchObject({ actionPath: path, metadata: data });
  });

  it('describes return recording without implying bilateral assent or settlement', () => {
    expect(rendered('LEASE_RETURN_CONFIRMED').body).toContain('Một bên');
    const completed = rendered('LEASE_RETURN_COMPLETED');
    expect(completed.title).toContain('đã được ghi nhận');
    expect(`${completed.title} ${completed.body}`).not.toMatch(/hai bên|cả hai|đồng ý|đã nhận tiền|đã hoàn tất/);
    expect(completed.body).toContain('quyết toán được xử lý riêng');
  });

  it('limits closure copy to the deposit-settlement record, including zero-transfer closure', () => {
    const closed = rendered('LEASE_CLOSED');
    expect(closed.title).toBe('Hồ sơ quyết toán cọc đã đóng');
    expect(closed.body).toContain('không xác nhận các khoản hoàn tiền thuê hoặc công nợ độc lập đã hoàn tất');
    expect(closed.title).not.toMatch(/đã nhận|đã thanh toán|tất cả|hợp đồng/);
  });

  it('does not infer absent transfers, receipt or consent from a deadline or acceptance', () => {
    for (const type of ['SETTLEMENT_PAYMENT_OVERDUE', paymentType]) {
      const item = rendered(type);
      expect(item.body).toMatch(/đối soát.*trạng thái hiện tại/);
      expect(`${item.title} ${item.body}`).not.toMatch(/chưa chuyển|không chuyển|chưa thanh toán|đã nhận|tự động|đã hủy/);
    }
    expect(rendered('SETTLEMENT_RESPONSE_OVERDUE').body).toContain('không thay thế sự đồng ý');
    expect(rendered('SETTLEMENT_AGREED').body).toContain('chuyển tiền và xác nhận nhận tiền được theo dõi riêng');
    expect(rendered('SETTLEMENT_DISPUTED').body).not.toMatch(/khiếu nại|quản trị|phán quyết/);
    expect(rendered('SETTLEMENT_PROPOSAL_INVALIDATED').body).toContain('không còn dùng để xác nhận');
  });

  const consumer = () => {
    const create = jest.fn<NotificationService['create']>().mockResolvedValue({} as never);
    const send = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    const commitOffsets = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    const service = new NotificationEventsConsumer(new ConfigService({ KAFKA_RETRY_ATTEMPTS: 1,
      KAFKA_RETRY_DELAY_MS: 0, KAFKA_DLT_TOPIC: 'settlement-test-dlt' }), { create } as unknown as NotificationService);
    Object.assign(service, { consumer: { commitOffsets }, producer: { send } });
    const payload = (value: unknown): Parameters<typeof service.consume>[0] => ({ topic: 'settlement-test', partition: 0,
      message: { offset: '41', value: encode(value) }, heartbeat: async () => {},
    } as Parameters<typeof service.consume>[0]);
    return { create, send, commitOffsets, service, payload };
  };

  it.each(types)('persists %s before offset acknowledgment', async type => {
    const x = consumer(); await x.service.consume(x.payload(event(type)));
    expect(x.create).toHaveBeenCalledWith(expect.objectContaining({ type, recipientId: 'stored-party', metadata: dataFor(type) }));
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledWith([{ topic: 'settlement-test', partition: 0, offset: '42' }]);
    expect(x.create.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });

  it.each(types)('quarantines invalid %s without echoing financial or recipient content', async type => {
    const x = consumer(); await x.service.consume(x.payload(event(type, { data: { ...dataFor(type), reason: 'PRIVATE_REASON' } })));
    expect(x.create).not.toHaveBeenCalled(); expect(x.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(x.send.mock.calls)).not.toMatch(/PRIVATE_REASON|stored-party|0f1e2d3c/);
    expect(x.send.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });
});
