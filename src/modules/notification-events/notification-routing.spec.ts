import { isSafeActionPath } from '../notification/domain/notification-content';
import { parseNotificationEvent, renderNotification } from './notification-event';

const id = 'a_b-1';
const render = (eventType: string, data: Record<string, string>) => renderNotification(parseNotificationEvent(Buffer.from(JSON.stringify({
  eventId: 'routing-event-1', eventType, version: 1, occurredAt: '2026-11-24T00:00:00.000Z', recipients: ['party'], data,
}))), 'party');

describe('notification routing, priority and vocabulary', () => {
  it.each([
    ['AMENDMENT_RESPONSE_NEEDED', { contractId: id }, `/dashboard/contracts/${id}?tab=end`],
    ['AMENDMENT_APPLIED', { contractId: id }, `/dashboard/contracts/${id}?tab=content`],
    ['RENEWAL_REQUESTED', { contractId: id }, `/dashboard/contracts/${id}?tab=end`],
    ['TERMINATION_RESPONSE_NEEDED', { contractId: id }, `/dashboard/contracts/${id}?tab=end`],
    ['TERMINATION_NOTICE_ISSUED', { contractId: id }, `/dashboard/invoices/${id}?section=monthly`],
    ['LEASE_RETURN_CONFIRMED', { contractId: id }, `/dashboard/contracts/${id}?tab=end`],
    ['SETTLEMENT_RESPONSE_NEEDED', { contractId: id }, `/dashboard/invoices/${id}?section=deposit`],
    ['AGREEMENT_SIGNING_TURN', { agreementId: id, agreementKind: 'DEPOSIT' }, `/dashboard/contracts/${id}?tab=sign`],
    ['AGREEMENT_FULLY_SIGNED', { agreementId: id, agreementKind: 'EARLY_EXIT' }, `/dashboard/contracts/${id}?tab=end`],
    ['AGREEMENT_SIGNING_DUE_SOON', { agreementId: id, agreementKind: 'LEASE' }, `/dashboard/contracts/${id}?tab=sign`],
    ['PAYMENT_REFUND_AUTO_CONFIRM_SOON', { paymentId: id }, `/dashboard/payments?paymentId=${id}`],
    ['PAYMENT_RECEIPT_AUTO_CONFIRM_SOON', { paymentId: id }, `/dashboard/payments?paymentId=${id}`],
    ['PAYMENT_RECEIPT_AUTO_CONFIRMED', { paymentId: id }, `/dashboard/payments?paymentId=${id}`],
    ['PAYMENT_DUE_SOON', { paymentId: id }, `/dashboard/payments?paymentId=${id}`],
    ['INVOICE_OVERDUE', { contractId: id, invoiceId: 'inv-1' }, `/dashboard/invoices/${id}?section=monthly&invoice=inv-1`],
  ])('%s routes to %s and stays a safe action path', (type, data, path) => {
    const rendered = render(type, data);
    expect(rendered.actionPath).toBe(path);
    expect(isSafeActionPath(rendered.actionPath)).toBe(true);
  });

  it.each([
    ['PAYMENT_OBLIGATION_OVERDUE', { paymentId: id }, 'URGENT'],
    ['INVOICE_OVERDUE', { contractId: id, invoiceId: 'inv-1' }, 'URGENT'],
    ['TERMINATION_NOTICE_ISSUED', { contractId: id }, 'URGENT'],
    ['PAYMENT_DUE_SOON', { paymentId: id }, 'HIGH'],
    ['PAYMENT_REFUND_AUTO_CONFIRM_SOON', { paymentId: id }, 'HIGH'],
    ['PAYMENT_RECEIPT_AUTO_CONFIRM_SOON', { paymentId: id }, 'HIGH'],
    ['PAYMENT_RECEIPT_AUTO_CONFIRMED', { paymentId: id }, 'HIGH'],
    ['AGREEMENT_SIGNING_DUE_SOON', { agreementId: id, agreementKind: 'DEPOSIT' }, 'HIGH'],
    ['INVOICE_PAYMENT_REMINDER', { contractId: id, invoiceId: 'inv-1' }, 'HIGH'],
    ['AGREEMENT_SIGNING_TURN', { agreementId: id, agreementKind: 'LEASE' }, 'HIGH'],
    ['AGREEMENT_FULLY_SIGNED', { agreementId: id, agreementKind: 'LEASE' }, 'NORMAL'],
    ['PAYMENT_RECEIPT_CONFIRMED', { paymentId: id }, 'NORMAL'],
  ])('%s has priority %s', (type, data, priority) => {
    expect(render(type, data).priority).toBe(priority);
  });

  it('uses the unified deposit-refund vocabulary for settlement copy', () => {
    for (const type of ['SETTLEMENT_RESPONSE_NEEDED', 'SETTLEMENT_DISPUTED', 'SETTLEMENT_AGREED', 'LEASE_CLOSED']) {
      const { title, body } = render(type, { contractId: id });
      expect(`${title} ${body}`).toContain('hoàn cọc');
    }
    expect(render('TERMINATION_APPROVED', { contractId: id }).body).toContain('ký số');
  });
});

describe('optional listing title made only of Unicode spaces', () => {
  it('is accepted and omitted from the body instead of invalidating the event', () => {
    const rendered = render('LISTING_APPROVED', { listingId: id, listingTitle: '\u00a0'.repeat(120) });
    expect(rendered.body).not.toMatch(/Tin:/);
  });
});
