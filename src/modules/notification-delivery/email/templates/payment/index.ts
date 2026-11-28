import { type AttachmentKind, type CategoryEmails, type EmailContext, type EmailSpec, subjectOf } from '../../email-spec';
import { type EmailTone, renderEmail } from '../../render-email';

const TZ = 'Asia/Ho_Chi_Minh';
export const RECEIPT_LINE = 'Biên nhận PDF được đính kèm trong email này.';

/** "49.000 ₫"; undefined for anything that is not a finite non-negative number. */
export function formatVnd(value: unknown): string | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
}

/** "dd/MM/yyyy HH:mm" in Asia/Ho_Chi_Minh; undefined for a missing/invalid date. */
export function formatVnDateTime(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

// Only short, plain labels are shown: anything else (free text, ids) is dropped rather than risk leaking it.
const label = (value: unknown, pattern: RegExp): string | undefined =>
  typeof value === 'string' && pattern.test(value.trim()) ? value.trim() : undefined;
const receiptNumberOf = (d: EmailContext['data']) => label(d.receiptNumber, /^[\w./-]{1,64}$/);
const periodOf = (d: EmailContext['data']) => label(d.period, /^[\p{L}\p{N} /-]{1,32}$/u);

interface Def {
  subject: string;
  tone: EmailTone;
  badge: string;
  attachment?: AttachmentKind;
  /** Receipts show the receipt number in the subject; everything else shows the amount when known. */
  suffix?: 'receipt';
}

function spec(def: Def): EmailSpec {
  return {
    policy: def.attachment ? 'ALWAYS' : 'OPT_IN',
    ...(def.attachment ? { attachments: [def.attachment] } : {}),
    render(ctx) {
      const d = ctx.data;
      const receiptNumber = receiptNumberOf(d);
      const amount = formatVnd(d.amount);
      const extra = def.suffix === 'receipt' ? receiptNumber : amount;
      const rows: [string, string | undefined][] = [
        ['Số tiền', amount],
        ['Kỳ', periodOf(d)],
        ['Hạn thanh toán', formatVnDateTime(d.dueAt)],
        ['Ngày hết hạn', formatVnDateTime(d.expiresAt)],
        ['Số biên nhận', receiptNumber],
      ];
      return {
        subject: subjectOf(extra ? `${def.subject} – ${extra}` : def.subject),
        ...renderEmail({
          template: def.attachment ? 'payment/receipt' : 'payment/notice',
          baseUrl: ctx.baseUrl,
          category: 'Thanh toán',
          preheader: ctx.body,
          heading: ctx.title,
          badge: { label: def.badge, tone: def.tone },
          bodyParagraphs: def.attachment ? [ctx.body, RECEIPT_LINE] : [ctx.body],
          detailRows: rows.filter((r): r is [string, string] => r[1] !== undefined),
          cta: ctx.actionUrl ? { label: 'Xem chi tiết', url: ctx.actionUrl } : undefined,
        }),
      };
    },
  };
}

const due = (subject: string): Def => ({ subject, tone: 'warning', badge: 'Sắp đến hạn' });
const action = (subject: string): Def => ({ subject, tone: 'warning', badge: 'Cần xử lý' });
const overdue = (subject: string): Def => ({ subject, tone: 'danger', badge: 'Quá hạn' });
const info = (subject: string): Def => ({ subject, tone: 'primary', badge: 'Thông báo' });
const receipt = (subject: string, attachment: AttachmentKind, suffix?: 'receipt'): Def => ({
  subject, tone: 'primary', badge: 'Thành công', attachment, suffix,
});

const DEFS: Record<string, Def> = {
  PAYMENT_REQUEST_CREATED: action('Bạn có khoản cần thanh toán'),
  PAYMENT_DUE_SOON: due('Sắp đến hạn thanh toán'),
  PAYMENT_OBLIGATION_OVERDUE: overdue('Khoản thanh toán đã quá hạn'),
  PAYMENT_TRANSFER_REPORTED: action('Cần xác nhận khoản chuyển tiền'),
  PAYMENT_RECEIPT_CONFIRMED: receipt('Thanh toán thành công', 'RENTAL_RECEIPT', 'receipt'),
  PAYMENT_RECEIPT_REJECTED: action('Khoản chuyển tiền bị từ chối xác nhận'),
  PAYMENT_RECEIPT_AUTO_CONFIRM_SOON: due('Sắp tự động xác nhận đã nhận tiền'),
  PAYMENT_REFUND_AUTO_CONFIRM_SOON: due('Sắp tự động xác nhận hoàn tiền'),
  PAYMENT_RECEIPT_AUTO_CONFIRMED: receipt('Hệ thống đã xác nhận thanh toán', 'RENTAL_RECEIPT', 'receipt'),
  INVOICE_ISSUED: action('Hóa đơn tháng đã được phát hành'),
  INVOICE_PAYMENT_REMINDER: due('Hóa đơn sắp đến hạn'),
  INVOICE_OVERDUE: overdue('Hóa đơn tháng đã quá hạn'),
  INVOICE_EXTENSION_REQUESTED: action('Có yêu cầu gia hạn thanh toán hóa đơn'),
  INVOICE_EXTENSION_APPROVED: info('Hóa đơn được gia hạn thanh toán'),
  INVOICE_EXTENSION_REJECTED: action('Yêu cầu gia hạn thanh toán bị từ chối'),
  INVOICE_EXTENSION_EXPIRED: overdue('Yêu cầu gia hạn đã hết hạn, hóa đơn quá hạn'),
  INVOICE_OVERDUE_ACTION_REQUIRED: action('Hóa đơn quá hạn cần chủ nhà xử lý'),
  INVOICE_OVERDUE_ACTION_RECORDED: info('Chủ nhà đã ghi nhận một bước xử lý hóa đơn quá hạn'),
  INVOICE_DEFERRED: info('Khoản chưa thanh toán được chuyển sang hóa đơn sau'),
  INVOICE_ROLLED_OVER: action('Khoản chưa thanh toán đã chuyển sang hóa đơn khác'),
  MEMBERSHIP_ACTIVATED: receipt('Gói đăng tin đã được kích hoạt', 'MEMBERSHIP_RECEIPT'),
  MEMBERSHIP_OVERPAYMENT_RECEIVED: receipt('Đã nhận khoản trả thừa', 'OVERPAYMENT_RECEIPT'),
  MEMBERSHIP_EXPIRING_SOON: due('Gói thành viên sắp hết hạn'),
  MEMBERSHIP_EXPIRED: overdue('Gói thành viên đã hết hạn'),
};

export const paymentEmails: CategoryEmails = Object.fromEntries(
  Object.entries(DEFS).map(([eventType, def]) => [eventType, spec(def)]),
);
