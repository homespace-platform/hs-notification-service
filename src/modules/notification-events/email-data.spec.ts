import { parseNotificationEvent, renderNotification } from './notification-event';

const encode = (eventType: string, data: Record<string, unknown>) =>
  Buffer.from(
    JSON.stringify({ eventId: 'e1', eventType, version: 1, occurredAt: '2026-11-28T00:00:00.000Z', recipients: ['u1'], data }),
  );
const parse = (eventType: string, data: Record<string, unknown>) => parseNotificationEvent(encode(eventType, data));

describe('additive email data on notification events', () => {
  it('keeps allow-listed extras on the notification metadata', () => {
    const event = parse('PAYMENT_RECEIPT_CONFIRMED', {
      paymentId: 'p1', receiptId: 'r1', receiptNumber: 'BN-1', amount: '1500000', period: '11/2026', legacy: false,
    });
    expect(event.data).toEqual({ paymentId: 'p1' });
    expect(renderNotification(event, 'u1').metadata).toEqual({
      paymentId: 'p1', receiptId: 'r1', receiptNumber: 'BN-1', amount: '1500000', period: '11/2026', legacy: false,
    });
  });

  it('accepts the legacy marker as boolean or string and exposes it as boolean true', () => {
    for (const legacy of [true, 'true']) {
      const event = parse('PAYMENT_RECEIPT_CONFIRMED', { paymentId: 'p1', legacy });
      expect(renderNotification(event, 'u1').metadata).toMatchObject({ legacy: true });
    }
  });

  it('keeps contractId/orderId as the identity key when the event needs it, and as an extra when it does not', () => {
    expect(renderNotification(parse('INVOICE_ISSUED', { contractId: 'c1', invoiceId: 'i1', dueAt: '2026-12-01' }), 'u1').metadata)
      .toEqual({ contractId: 'c1', invoiceId: 'i1', dueAt: '2026-12-01' });
    expect(renderNotification(parse('MEMBERSHIP_OVERPAYMENT_RECEIVED', { orderId: 'o1', overpaymentId: 'op1' }), 'u1').metadata)
      .toMatchObject({ orderId: 'o1', overpaymentId: 'op1' });
    expect(renderNotification(parse('AGREEMENT_FULLY_SIGNED', { agreementId: 'a1', agreementKind: 'LEASE', contractId: 'c1' }), 'u1').metadata)
      .toEqual({ agreementId: 'a1', agreementKind: 'LEASE', contractId: 'c1' });
  });

  it('drops malformed extras instead of sending the event to the DLT', () => {
    const event = parse('PAYMENT_RECEIPT_CONFIRMED', { paymentId: 'p1', receiptId: '../x', amount: '<b>', legacy: 'maybe', agreementType: 'lease' });
    expect(renderNotification(event, 'u1').metadata).toEqual({ paymentId: 'p1' });
  });

  it('still rejects genuinely unknown keys, and extras on event types that do not take them', () => {
    expect(() => parse('PAYMENT_RECEIPT_CONFIRMED', { paymentId: 'p1', receiptId: 'r1', bankAccount: '123' })).toThrow('Invalid notification event');
    expect(() => parse('INVOICE_ISSUED', { contractId: 'c1', invoiceId: 'i1', ownerId: 'o' })).toThrow('Invalid notification event');
    expect(() => parse('NEWS_PUBLISHED', { newsId: 'n1', slug: 's', amount: '1' })).toThrow('Invalid notification event');
    expect(() => parse('PAYMENT_RECEIPT_CONFIRMED', { receiptId: 'r1' })).toThrow('Invalid notification event');
  });
});

describe('payload shapes produced by hs-core-api (wave 1)', () => {
  it('accepts integer amounts and expiresAt exactly as Core sends them', () => {
    expect(renderNotification(parse('PAYMENT_RECEIPT_CONFIRMED', {
      paymentId: 'p1', receiptId: 'r1', receiptNumber: 'HS-20261128-0001', amount: 1500000,
    }), 'u1').metadata).toEqual({ paymentId: 'p1', receiptId: 'r1', receiptNumber: 'HS-20261128-0001', amount: '1500000' });
    expect(renderNotification(parse('PAYMENT_DUE_SOON', { paymentId: 'p1', amount: 49000, dueAt: '2026-12-01T03:00:00Z' }), 'u1').metadata)
      .toMatchObject({ amount: '49000', dueAt: '2026-12-01T03:00:00Z' });
    expect(renderNotification(parse('MEMBERSHIP_ACTIVATED', { orderId: 'o1', amount: 49000 }), 'u1').metadata)
      .toMatchObject({ orderId: 'o1', amount: '49000' });
    expect(renderNotification(parse('MEMBERSHIP_OVERPAYMENT_RECEIVED', { orderId: 'o1', overpaymentId: 'op1', amount: 49000 }), 'u1').metadata)
      .toMatchObject({ overpaymentId: 'op1', amount: '49000' });
    for (const type of ['MEMBERSHIP_EXPIRING_SOON', 'MEMBERSHIP_EXPIRED']) {
      expect(renderNotification(parse(type, { expiresAt: '2026-12-28T03:25:46Z' }), 'u1').metadata)
        .toMatchObject({ expiresAt: '2026-12-28T03:25:46Z' });
    }
  });

  it('drops negative or fractional amounts instead of failing the event', () => {
    expect(renderNotification(parse('MEMBERSHIP_ACTIVATED', { orderId: 'o1', amount: -1 }), 'u1').metadata).toEqual({ orderId: 'o1' });
    expect(renderNotification(parse('MEMBERSHIP_ACTIVATED', { orderId: 'o1', amount: 1.5 }), 'u1').metadata).toEqual({ orderId: 'o1' });
  });
});
