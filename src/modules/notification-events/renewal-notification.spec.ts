import { parseNotificationEvent, renderNotification } from './notification-event';

const types = ['RENEWAL_REQUESTED', 'RENEWAL_APPROVED', 'RENEWAL_REJECTED', 'RENEWAL_EXPIRED'];
const contractId = '0f1e2d3c-4b5a-4968-8776-655443322110';
const event = (type: string, data: unknown = { contractId }, recipients = ['party']) => ({
  eventId: 'renewal-event-1', eventType: type, version: 1, occurredAt: '2026-11-14T00:00:00.000Z', recipients, data,
});
const parse = (value: unknown) => parseNotificationEvent(Buffer.from(JSON.stringify(value)));

describe('renewal notification contract', () => {
  it.each(types)('%s renders minimal root identity and a fixed authenticated route', type => {
    const result = renderNotification(parse(event(type)), 'party');
    expect(result).toMatchObject({ type, category: 'CONTRACT', priority: 'NORMAL', recipientId: 'party',
      actionPath: `/dashboard/contracts/${contractId}`, metadata: { contractId } });
    expect(Object.keys(result.metadata ?? {})).toEqual(['contractId']);
    expect(`${result.title} ${result.body}`).not.toMatch(/VND|PRIVATE|đã thanh toán|\d{2}\/\d{2}/);
  });

  it.each(types)('%s rejects extra fields, other identity and fanout', type => {
    for (const data of [{ contractId, note: 'PRIVATE' }, { agreementId: contractId }, { contractId: '../other' }, {}])
      expect(() => parse(event(type, data))).toThrow('Invalid notification event');
    expect(() => parse(event(type, { contractId }, ['owner', 'tenant']))).toThrow('Invalid notification event');
  });

  it('review-ready accepts a renewal child; no root decision payload can impersonate a signing event', () => {
    expect(renderNotification(parse(event('AGREEMENT_REVIEW_READY', { agreementId: 'child-1', agreementKind: 'RENEWAL' })), 'party')
      .actionPath).toBe('/dashboard/contracts/child-1');
    expect(() => parse(event('AGREEMENT_REVIEW_READY', { contractId }))).toThrow('Invalid notification event');
  });
});
