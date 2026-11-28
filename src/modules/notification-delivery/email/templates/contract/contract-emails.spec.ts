import { type EmailContext, SUBJECT_PREFIX } from '../../email-spec';
import { contractEmails } from './index';
import { formatVnd, formatVnDate } from './format';

const BASE = 'https://homespace.id.vn';
const ctx = (over: Partial<EmailContext> = {}): EmailContext => ({
  eventType: 'X',
  title: 'Tiêu đề hợp đồng',
  body: 'Nội dung thông báo.',
  actionUrl: `${BASE}/dashboard/contracts/c1?tab=sign`,
  baseUrl: BASE,
  data: {},
  occurredAt: new Date('2026-11-28T03:00:00.000Z'),
  ...over,
});
const types = Object.keys(contractEmails);

describe('contract emails', () => {
  it('covers the "Có" events, all OPT_IN, only the fully-signed spec attaches LEASE_BUNDLE', () => {
    expect(types).toHaveLength(23);
    for (const t of ['AGREEMENT_FULLY_SIGNED', 'COMPLAINT_FINAL_DECISION', 'BRANCH_DAILY_DIGEST', 'LEASE_CLOSED'])
      expect(types).toContain(t);
    for (const t of ['CONTRACT_SIGNED', 'RENEWAL_APPROVED', 'AMENDMENT_DECIDED', 'COMPLAINT_CLOSED']) expect(types).not.toContain(t);
    for (const [t, s] of Object.entries(contractEmails)) {
      expect(s.policy).toBe('OPT_IN');
      expect(s.attachments).toEqual(t === 'AGREEMENT_FULLY_SIGNED' ? ['LEASE_BUNDLE'] : undefined);
    }
  });

  it.each(types)('%s renders with realistic and empty data', (t) => {
    const full = contractEmails[t].render(
      ctx({
        eventType: t,
        data: { contractNumber: 'HD-001', dueAt: '2026-12-01T10:30:00.000Z', amount: 1500000, effectiveDate: '2026-12-01', attentionCount: '3' },
      }),
    );
    expect(full.subject).toBe(`${SUBJECT_PREFIX}Tiêu đề hợp đồng`);
    expect(full.html).toContain('Tiêu đề hợp đồng');
    expect(full.html).toContain('Nội dung thông báo.');
    expect(full.html).toContain('href="https://homespace.id.vn/dashboard/contracts/c1?tab&#x3D;sign"');
    expect(full.html).toContain('17:30 01/12/2026');
    expect(full.html).toContain('1.500.000 ₫');
    expect(full.html).toContain('01/12/2026');
    expect(full.text).toContain('Tiêu đề hợp đồng');
    const empty = contractEmails[t].render(ctx({ eventType: t, actionUrl: '' }));
    expect(empty.html).not.toMatch(/Mã hợp đồng|Số tiền|\{\{|undefined|NaN/);
    expect(empty.html).not.toMatch(/Mở hợp đồng|Mở hồ sơ khiếu nại|Xem việc cần chú ý/);
    expect(empty.html).toContain('Nội dung thông báo.');
  });

  it('uses the right tone, category and CTA per group', () => {
    const r = (t: string) => contractEmails[t].render(ctx({ eventType: t }));
    expect(r('TERMINATION_ENDED').html).toContain('#b91c1c');
    expect(r('AGREEMENT_SIGNING_DUE_SOON').html).toContain('#92400e');
    expect(r('AGREEMENT_FULLY_SIGNED').html).toContain('#2563eb');
    expect(r('AGREEMENT_FULLY_SIGNED').html).toContain('mục Hợp đồng');
    expect(r('AGREEMENT_FULLY_SIGNED').html).toContain('Mở hợp đồng');
    expect(r('BRANCH_DAILY_DIGEST').html).toContain('mục Hệ thống');
  });

  it('fully-signed text differs for lease and deposit', () => {
    const send = (data: Record<string, unknown>) => contractEmails.AGREEMENT_FULLY_SIGNED.render(ctx({ data }));
    const lease = send({ agreementType: 'LEASE' });
    expect(lease.text).toContain('Hợp đồng thuê và hợp đồng cọc đã ký được đính kèm trong email này.');
    expect(lease.html).not.toContain('Bản PDF sẽ được gửi kèm');
    const deposit = send({ agreementKind: 'DEPOSIT' });
    expect(deposit.text).toContain('Hợp đồng cọc đã ký xong. Bản PDF sẽ được gửi kèm khi hợp đồng thuê hoàn tất.');
    expect(deposit.html).not.toContain('đính kèm trong email này');
    for (const other of [send({}), send({ agreementType: 'AMENDMENT' })]) expect(other.text).not.toMatch(/đính kèm|PDF/);
  });

  it('escapes user data and subject newlines', () => {
    const out = contractEmails.AGREEMENT_SIGNING_TURN.render(
      ctx({ title: 'A <script>x</script>\nB', body: '<img src=x onerror=1>', data: { contractNumber: '<b>HD</b>' } }),
    );
    expect(out.subject).toBe('[HomeSpace] A <script>x</script> B');
    expect(out.html).not.toMatch(/<script>x|<img src=x|<b>HD/);
    expect(out.html).toContain('&lt;b&gt;HD&lt;/b&gt;');
  });

  it('never prints CCCD, bank, phone or address even if present in data', () => {
    const out = contractEmails.SETTLEMENT_RESPONSE_NEEDED.render(
      ctx({
        data: {
          contractNumber: 'HD-9',
          cccd: '079123456789',
          bankAccount: '0123456789',
          phone: '0901234567',
          counterpartyAddress: '12 Phố Cấm',
          address: '99 Đường Kín',
        },
      }),
    );
    expect(out.html + out.text).not.toMatch(/079123456789|0123456789|0901234567|Phố Cấm|Đường Kín/);
    expect(out.html).toContain('HD-9');
  });

  it('formats dates in Asia/Ho_Chi_Minh and amounts in vi-VN', () => {
    expect(formatVnDate('2026-11-30T17:30:00.000Z', true)).toBe('00:30 01/12/2026');
    expect(formatVnDate('2026-11-30T17:30:00.000Z', false)).toBe('01/12/2026');
    expect(formatVnDate('2026-12-01', true)).toBe('01/12/2026');
    expect(formatVnDate('không phải ngày', true)).toBeUndefined();
    expect(formatVnd(1234567)).toBe('1.234.567 ₫');
    expect(formatVnd('2500000')).toBe('2.500.000 ₫');
    expect(formatVnd('abc')).toBeUndefined();
    expect(formatVnd(-1)).toBeUndefined();
  });

  it('labels the deadline row by event kind', () => {
    const data = { dueAt: '2026-12-01T10:30:00.000Z' };
    expect(contractEmails.AGREEMENT_SIGNING_TURN.render(ctx({ data })).html).toContain('Hạn ký');
    expect(contractEmails.AMENDMENT_RESPONSE_NEEDED.render(ctx({ data })).html).toContain('Hạn phản hồi');
  });
});
