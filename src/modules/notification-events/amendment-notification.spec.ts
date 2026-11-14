import { parseNotificationEvent, renderNotification } from './notification-event';

const types = ['AMENDMENT_RESPONSE_NEEDED', 'AMENDMENT_DECIDED', 'AMENDMENT_WITHDRAWN', 'AMENDMENT_EXPIRED', 'AMENDMENT_APPLIED'];
const contractId = '0f1e2d3c-4b5a-4968-8776-655443322110';
const event = (type: string, data: unknown = { contractId }, recipients = ['party']) => ({
  eventId: 'amendment-event-1', eventType: type, version: 1, occurredAt: '2026-11-14T00:00:00.000Z', recipients, data,
});
const parse = (value: unknown) => parseNotificationEvent(Buffer.from(JSON.stringify(value)));

describe('amendment notification contract', () => {
  it.each(types)('%s renders a neutral root-contract link with exact metadata', type => {
    const result = renderNotification(parse(event(type)), 'party');
    expect(result).toMatchObject({ type, category: 'CONTRACT', priority: 'NORMAL', recipientId: 'party',
      actionPath: `/dashboard/contracts/${contractId}`, metadata: { contractId } });
    expect(Object.keys(result.metadata ?? {})).toEqual(['contractId']);
    expect(`${result.title} ${result.body}`).not.toMatch(/VND|PRIVATE|chữ ký hợp lệ|đã thanh toán|\d{2}\/\d{2}/);
  });

  it.each(types)('%s rejects extra data, wrong identity and multi-recipient envelopes', type => {
    for (const data of [{ contractId, reason: 'PRIVATE' }, { agreementId: contractId }, { contractId: '../other' }, {}])
      expect(() => parse(event(type, data))).toThrow('Invalid notification event');
    expect(() => parse(event(type, { contractId }, ['landlord', 'tenant']))).toThrow('Invalid notification event');
  });

  it('retains review-ready on the exact amendment signing child', () => {
    expect(renderNotification(parse(event('AGREEMENT_REVIEW_READY', { agreementId: 'child-1', agreementKind: 'AMENDMENT' })), 'party')
      .actionPath).toBe('/dashboard/contracts/child-1');
  });
});
