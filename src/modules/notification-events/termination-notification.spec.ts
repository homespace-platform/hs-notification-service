import { parseNotificationEvent, renderNotification } from './notification-event';

const types = ['TERMINATION_RESPONSE_NEEDED', 'TERMINATION_AGREED', 'TERMINATION_DECLINED', 'TERMINATION_WITHDRAWN',
  'TERMINATION_NOTICE_ISSUED', 'TERMINATION_REVIEW_REQUESTED', 'TERMINATION_REVIEW_APPROVED',
  'TERMINATION_NOTICE_CANCELLED', 'TERMINATION_ENDED', 'LEASE_EXPIRED'];
const contractId = '0f1e2d3c-4b5a-4968-8776-655443322110';
const event = (type: string, data: unknown = { contractId }, recipients = ['party']) => ({
  eventId: 'termination-event-1', eventType: type, version: 1, occurredAt: '2026-11-14T00:00:00.000Z', recipients, data,
});
const parse = (value: unknown) => parseNotificationEvent(Buffer.from(JSON.stringify(value)));

describe('termination notification contract', () => {
  it.each(types)('%s renders neutral copy and the authenticated root route', type => {
    const result = renderNotification(parse(event(type)), 'party');
    expect(result).toMatchObject({ type, category: 'CONTRACT', priority: 'NORMAL', recipientId: 'party',
      actionPath: `/dashboard/contracts/${contractId}`, metadata: { contractId } });
    expect(Object.keys(result.metadata ?? {})).toEqual(['contractId']);
    expect(`${result.title} ${result.body}`).not.toMatch(/VND|PRIVATE|đã thanh toán|đã bàn giao|\d{2}\/\d{2}/);
  });

  it.each(types)('%s rejects extra/private data and fanout', type => {
    for (const data of [{ contractId, reason: 'PRIVATE' }, { agreementId: contractId }, { contractId: '../other' }, {}])
      expect(() => parse(event(type, data))).toThrow('Invalid notification event');
    expect(() => parse(event(type, { contractId }, ['owner', 'tenant']))).toThrow('Invalid notification event');
  });

  it('uses exact child signing identity for an early-exit PDF', () => {
    const signed = renderNotification(parse(event('AGREEMENT_FULLY_SIGNED',
      { agreementId: 'child-1', agreementKind: 'EARLY_EXIT' })), 'party');
    expect(signed.actionPath).toBe('/dashboard/contracts/child-1');
    expect(() => parse(event('AGREEMENT_FULLY_SIGNED', { contractId }))).toThrow('Invalid notification event');
  });
});
