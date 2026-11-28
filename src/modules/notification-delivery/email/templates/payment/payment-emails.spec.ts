import type { AttachmentKind, EmailContext } from '../../email-spec';
import { formatVnd, formatVnDateTime, paymentEmails, RECEIPT_LINE } from './index';

const BASE = 'https://homespace.id.vn';
const ctxOf = (eventType: string, data: Record<string, unknown>, over: Partial<EmailContext> = {}): EmailContext => ({
  eventType,
  title: 'Tiêu đề thử',
  body: 'Nội dung thử',
  actionUrl: `${BASE}/dashboard/payments?paymentId=p1`,
  baseUrl: BASE,
  data,
  occurredAt: new Date('2026-11-28T00:00:00Z'),
  ...over,
});
const FULL = {
  amount: 49000, period: '11/2026', dueAt: '2026-12-05T10:30:00Z', receiptNumber: 'HS-RC-20261128-0001',
  // must never be shown
  bankAccount: '0123456789012', cccd: '079123456789', phone: '0912345678',
};
const EXPECTED: Record<string, AttachmentKind> = {
  PAYMENT_RECEIPT_CONFIRMED: 'RENTAL_RECEIPT',
  PAYMENT_RECEIPT_AUTO_CONFIRMED: 'RENTAL_RECEIPT',
  MEMBERSHIP_ACTIVATED: 'MEMBERSHIP_RECEIPT',
  MEMBERSHIP_OVERPAYMENT_RECEIVED: 'OVERPAYMENT_RECEIPT',
};

describe('payment emails', () => {
  const types = Object.keys(paymentEmails);

  it('covers exactly the 24 payment-category events marked "Có"', () => {
    expect(types).toHaveLength(24);
    for (const t of ['INVOICE_AMOUNT_UPDATED', 'INVOICE_METER_REMINDER', 'INVOICE_DRAFT_READY', 'INVOICE_OVERDUE_ACTION_ACKNOWLEDGED'])
      expect(types).not.toContain(t);
  });

  it('policy/attachments: receipts ALWAYS with a PDF, the rest OPT_IN without', () => {
    for (const t of types) {
      const kind = EXPECTED[t];
      expect([t, paymentEmails[t].policy, paymentEmails[t].attachments]).toEqual([
        t,
        kind ? 'ALWAYS' : 'OPT_IN',
        kind ? [kind] : undefined,
      ]);
    }
  });

  it.each(Object.keys(paymentEmails))('%s renders with full and empty data', (t) => {
    const full = paymentEmails[t].render(ctxOf(t, FULL));
    const empty = paymentEmails[t].render(ctxOf(t, {}));
    for (const out of [full, empty]) {
      expect(out.subject).toMatch(/^\[HomeSpace\] \S/);
      expect(out.html).toContain('Xem chi tiết');
      expect(out.html).toContain('Thanh toán');
      expect(out.html).toContain('Tiêu đề thử');
      expect(out.html.includes(RECEIPT_LINE)).toBe(!!EXPECTED[t]);
      expect(out.text.includes(RECEIPT_LINE)).toBe(!!EXPECTED[t]);
    }
    expect(full.html).toContain('49.000 ₫');
    expect(full.html).toContain('05/12/2026 17:30');
    expect(full.html).toContain('11/2026');
    expect(empty.html).not.toContain('Số tiền');
    expect(empty.html).not.toContain('Hạn thanh toán');
  });

  it('does not leak bank account, CCCD or phone', () => {
    for (const t of types) {
      const out = paymentEmails[t].render(ctxOf(t, FULL));
      for (const s of ['0123456789012', '079123456789', '0912345678'])
        expect(out.subject + out.html + out.text).not.toContain(s);
    }
  });

  it('puts the receipt number in the subject and drops unsafe ones', () => {
    const s = paymentEmails.PAYMENT_RECEIPT_CONFIRMED;
    expect(s.render(ctxOf('x', { receiptNumber: 'HS-1' })).subject).toBe('[HomeSpace] Thanh toán thành công – HS-1');
    const bad = s.render(ctxOf('x', { receiptNumber: '<b>0912345678 x</b>' }));
    expect(bad.subject).toBe('[HomeSpace] Thanh toán thành công');
    expect(bad.html).not.toContain('0912345678');
  });

  it('escapes title/body and keeps the subject on one line', () => {
    const out = paymentEmails.PAYMENT_DUE_SOON.render(
      ctxOf('x', {}, { title: '<script>alert(1)</script>\nX', body: '<img src=x onerror=1>' }),
    );
    expect(out.html).not.toContain('<script>alert');
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it('tones: overdue = danger, due/action = warning, success = primary', () => {
    const html = (t: string) => paymentEmails[t].render(ctxOf(t, {})).html;
    expect(html('INVOICE_OVERDUE')).toContain('#b91c1c');
    expect(html('INVOICE_PAYMENT_REMINDER')).toContain('#92400e');
    expect(html('PAYMENT_TRANSFER_REPORTED')).toContain('#92400e');
    expect(html('PAYMENT_RECEIPT_CONFIRMED')).toContain('#2563eb');
  });

  it('formats currency and Vietnam time', () => {
    expect(formatVnd(49000)).toBe('49.000 ₫');
    expect(formatVnd('1250000')).toBe('1.250.000 ₫');
    expect(formatVnd(0)).toBe('0 ₫');
    expect(formatVnd('abc')).toBeUndefined();
    expect(formatVnd(undefined)).toBeUndefined();
    expect(formatVnDateTime('2026-12-31T20:05:00Z')).toBe('01/01/2027 03:05');
    expect(formatVnDateTime('nope')).toBeUndefined();
    expect(formatVnDateTime(null)).toBeUndefined();
  });
});
