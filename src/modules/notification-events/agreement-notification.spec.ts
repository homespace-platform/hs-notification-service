import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { parseNotificationEvent, renderNotification } from './notification-event';
import { NotificationEventsConsumer } from './notification-events.consumer';
import { NotificationService } from '../notification/application/notification.service';

const types = ['AGREEMENT_REVIEW_READY', 'AGREEMENT_SIGNING_TURN', 'AGREEMENT_FULLY_SIGNED', 'AGREEMENT_SIGNATURE_NEEDS_REVIEW'];
const kinds = ['LEASE', 'DEPOSIT', 'AMENDMENT', 'RENEWAL', 'MOVE_IN', 'EARLY_EXIT'];
const matrix = types.flatMap(type => kinds.map(kind => [type, kind] as const));
const agreementId = '0f1e2d3c-4b5a-4968-8776-655443322110';
const event = (type = types[0], overrides: Record<string, unknown> = {}) => ({
  eventId: 'agreement-event-1', eventType: type, version: 1, occurredAt: '2026-11-14T00:00:00.000Z',
  recipients: ['stored-party'], data: { agreementId, agreementKind: 'LEASE' }, ...overrides,
});
const withKind = (type: string, agreementKind: unknown, id: unknown = agreementId) => event(type, { data: { agreementId: id, agreementKind } });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const parse = (value: unknown) => parseNotificationEvent(encode(value));
const routeFor = (kind: string, id = agreementId) =>
  `/dashboard/contracts/${encodeURIComponent(id)}${kind === 'MOVE_IN' ? '?workflow=move-in' : ''}`;
const copy = (type: string) => { const r = renderNotification(parse(event(type)), 'p'); return `${r.title} ${r.body}`; };

describe('agreement signing notification acceptance', () => {
  it.each(matrix)('%s/%s renders CONTRACT/NORMAL with exact metadata and the fixed route', (type, kind) => {
    const rendered = renderNotification(parse(withKind(type, kind)), 'stored-party');
    expect(rendered).toMatchObject({ type, category: 'CONTRACT', priority: 'NORMAL', recipientId: 'stored-party',
      sourceEventId: 'agreement-event-1', actionPath: routeFor(kind), metadata: { agreementId, agreementKind: kind } });
    expect(Object.keys(rendered.metadata ?? {}).sort()).toEqual(['agreementId', 'agreementKind']);
    expect(rendered.title.length).toBeGreaterThan(0); expect(rendered.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(rendered)).not.toMatch(/VND|\d{2}\/\d{2}|PRIVATE|recipientSide|LANDLORD|TENANT|revision|section=/);
  });

  it.each(['lease', 'Lease', 'ROOT_LEASE', '', ' LEASE', 'LEASE ', null, 3, ['LEASE'], { a: 1 }, 'constructor', '__proto__'])(
    'rejects unknown or malformed kind %j for every type', kind => {
      for (const type of types) expect(() => parse(withKind(type, kind))).toThrow('Invalid notification event');
    });

  it('encodes the id; only MOVE_IN gets the workflow suffix', () => {
    expect(renderNotification(parse(withKind(types[1], 'AMENDMENT', 'a_b-1')), 'p').actionPath).toBe('/dashboard/contracts/a_b-1');
    expect(renderNotification(parse(withKind(types[1], 'MOVE_IN', 'a_b-1')), 'p').actionPath).toBe('/dashboard/contracts/a_b-1?workflow=move-in');
  });

  it.each(['contractId', 'invoiceId', 'envelopeId', 'revision', 'role', 'amount', 'note', 'reason', 'failureCode', 'pdfUrl', 'actorId',
    'recipientSide', 'actionPath', 'deadline', '__proto__'])('rejects extra private or routing data %s in every type', key => {
    const data = JSON.parse(`{"agreementId":"${agreementId}","agreementKind":"LEASE","${key}":"PRIVATE"}`) as unknown;
    for (const type of types) expect(() => parse(event(type, { data }))).toThrow('Invalid notification event');
  });

  it.each([{}, { agreementId }, { agreementKind: 'LEASE' }, { agreementId, agreementKind: undefined }, { id: agreementId, agreementKind: 'LEASE' },
    { contractId: agreementId, agreementKind: 'LEASE' }, { agreementId, kind: 'LEASE' }])('rejects missing or renamed identity keys %j', data => {
    for (const type of types) expect(() => parse(event(type, { data }))).toThrow('Invalid notification event');
  });

  it.each([null, '', 3, '../x', 'a/b', 'a?b', '<script>', 'x'.repeat(201), ' a', 'a b', '?workflow=move-in'])('rejects unsafe agreement id %j', id => {
    for (const type of types) expect(() => parse(withKind(type, 'LEASE', id))).toThrow('Invalid notification event');
  });

  it.each([{ recipients: [] }, { recipients: ['a', 'b'] }, { recipients: ['a', 'a'] }, { version: 2 }, { actorId: 'private' }, { extra: 1 },
    { data: [] }, { data: null }, { occurredAt: '2026-11-14T00:00:00Z' }, { eventType: 'AGREEMENT_EARLY_EXIT_READY' },
    { eventType: 'AGREEMENT_REJECTED' }, { eventType: 'agreement_review_ready' }])('rejects malformed envelope %j', overrides => {
    for (const type of types) expect(() => parse(event(type, overrides))).toThrow('Invalid notification event');
  });

  it('keeps legacy contract, handover, invoice and membership contracts unaffected', () => {
    const legacy = renderNotification(parse(event('CONTRACT_SIGNED', { recipients: ['a', 'b'], data: { contractId: 'legacy-1' } })), 'a');
    expect(legacy.actionPath).not.toMatch(/dashboard\/contracts|workflow/);
    expect(renderNotification(parse(event('MOVE_IN_HANDOVER_READY', { data: { contractId: agreementId } })), 'p').actionPath)
      .toBe(`/dashboard/invoices/${agreementId}?section=deposit&workflow=move-in`);
    expect(parse(event('INVOICE_ISSUED', { data: { contractId: agreementId, invoiceId: 'inv-1' } })).eventType).toBe('INVOICE_ISSUED');
    expect(parse(event('MEMBERSHIP_ACTIVATED', { data: { orderId: 'order-1' } })).eventType).toBe('MEMBERSHIP_ACTIVATED');
    // Agreement identity never satisfies other shapes (and vice versa).
    expect(() => parse(event('CONTRACT_SIGNED', { data: { agreementId, agreementKind: 'LEASE' } }))).toThrow();
    expect(() => parse(event('MOVE_IN_HANDOVER_READY', { data: { agreementId, agreementKind: 'MOVE_IN' } }))).toThrow();
    expect(() => parse(event(types[0], { data: { contractId: agreementId } }))).toThrow();
  });

  it('keeps neutral copy: no unverified signature, retry, validity, terms-applied or money claims', () => {
    for (const type of types) expect(copy(type)).not.toMatch(/\d|VND|tiền|hợp lệ|thử lại|bị chặn|có hiệu lực/);
    expect(copy('AGREEMENT_REVIEW_READY')).toMatch(/có thể cần bạn xem xét/);
    expect(copy('AGREEMENT_REVIEW_READY')).not.toMatch(/PDF|sẵn sàng ký|có thể ký/);
    expect(copy('AGREEMENT_SIGNING_TURN')).toMatch(/hoàn tất phần của họ/);
    expect(copy('AGREEMENT_SIGNING_TURN')).not.toMatch(/xác minh|chữ ký số/);
    expect(copy('AGREEMENT_FULLY_SIGNED')).toMatch(/đã được xác minh hoàn tất/);
    expect(copy('AGREEMENT_FULLY_SIGNED')).toMatch(/không xác nhận nội dung đã được áp dụng/);
    expect(copy('AGREEMENT_SIGNATURE_NEEDS_REVIEW')).toMatch(/cần được kiểm tra/);
    expect(copy('AGREEMENT_SIGNATURE_NEEDS_REVIEW')).toMatch(/liên hệ bộ phận hỗ trợ/);
  });

  const consumer = () => {
    const create = jest.fn<NotificationService['create']>().mockResolvedValue({} as never);
    const send = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    const commitOffsets = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    const service = new NotificationEventsConsumer(new ConfigService({ KAFKA_RETRY_ATTEMPTS: 1,
      KAFKA_RETRY_DELAY_MS: 0, KAFKA_DLT_TOPIC: 'agreement-test-dlt' }), { create } as unknown as NotificationService);
    Object.assign(service, { consumer: { commitOffsets }, producer: { send } });
    const payload = (value: unknown): Parameters<typeof service.consume>[0] => ({ topic: 'agreement-test', partition: 0,
      message: { offset: '41', value: encode(value) }, heartbeat: async () => {},
    } as Parameters<typeof service.consume>[0]);
    return { create, send, commitOffsets, service, payload };
  };

  it.each(types)('persists %s before offset acknowledgment', async type => {
    const x = consumer(); await x.service.consume(x.payload(event(type)));
    expect(x.create).toHaveBeenCalledWith(expect.objectContaining({ type, recipientId: 'stored-party',
      metadata: { agreementId, agreementKind: 'LEASE' } }));
    expect(x.send).not.toHaveBeenCalled();
    expect(x.commitOffsets).toHaveBeenCalledWith([{ topic: 'agreement-test', partition: 0, offset: '42' }]);
    expect(x.create.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });

  it.each([
    ['private extra key', event(types[0], { data: { agreementId, agreementKind: 'LEASE', note: 'PRIVATE_NOTE' } })],
    ['malformed kind', withKind(types[1], 'EARLY_EXIT_EXTRA')],
    ['REVIEW_READY with unknown kind', withKind(types[0], 'UNKNOWN')],
  ])('quarantines a rejected payload (%s) to the redacted DLT before committing', async (_name, bad) => {
    const x = consumer(); await x.service.consume(x.payload(bad));
    expect(x.create).not.toHaveBeenCalled(); expect(x.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(x.send.mock.calls)).not.toMatch(/PRIVATE_NOTE|stored-party|0f1e2d3c|EARLY_EXIT|AMENDMENT/);
    expect(x.send.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
  });
});
