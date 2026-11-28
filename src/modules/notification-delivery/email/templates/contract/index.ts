import { type CategoryEmails, type EmailContext, type EmailSpec, subjectOf } from '../../email-spec';
import { type EmailTone, renderEmail } from '../../render-email';
import { formatVnd, formatVnDate, pick } from './format';

type Group =
  | 'signing-needed'
  | 'fully-signed'
  | 'amendment'
  | 'renewal'
  | 'termination'
  | 'settlement'
  | 'complaint'
  | 'digest';

interface Def {
  group: Group;
  tone: EmailTone;
  badge: string;
  /** Label of the deadline row; the row is shown only when the event data carries a date. */
  deadline?: 'Hạn ký' | 'Hạn phản hồi';
}

const SIGN = (badge: string): Def => ({ group: 'signing-needed', tone: 'warning', badge, deadline: 'Hạn ký' });
const RESPOND = (group: Group, tone: EmailTone, badge: string): Def => ({ group, tone, badge, deadline: 'Hạn phản hồi' });

const DEFS: Record<string, Def> = {
  AGREEMENT_REVIEW_READY: SIGN('Cần xem xét và ký'),
  AGREEMENT_SIGNING_TURN: SIGN('Đến lượt bạn ký'),
  AGREEMENT_SIGNING_DUE_SOON: SIGN('Sắp hết hạn ký'),
  AGREEMENT_SIGNATURE_NEEDS_REVIEW: { group: 'signing-needed', tone: 'warning', badge: 'Cần kiểm tra chữ ký' },
  AGREEMENT_FULLY_SIGNED: { group: 'fully-signed', tone: 'primary', badge: 'Đã đủ chữ ký số' },
  AMENDMENT_RESPONSE_NEEDED: RESPOND('amendment', 'warning', 'Cần phản hồi'),
  AMENDMENT_APPLIED: { group: 'amendment', tone: 'primary', badge: 'Phụ lục đã áp dụng' },
  LEASE_RENEWAL_WINDOW_OPENED: RESPOND('renewal', 'primary', 'Thời gian gia hạn'),
  RENEWAL_REQUESTED: RESPOND('renewal', 'warning', 'Cần phản hồi'),
  TERMINATION_RESPONSE_NEEDED: RESPOND('termination', 'warning', 'Cần phản hồi'),
  TERMINATION_NOTICE_ISSUED: RESPOND('termination', 'danger', 'Thông báo chấm dứt'),
  TERMINATION_REVIEW_REQUESTED: RESPOND('termination', 'warning', 'Cần phản hồi'),
  TERMINATION_ENDED: { group: 'termination', tone: 'danger', badge: 'Hợp đồng đã chấm dứt' },
  LEASE_EXPIRED: { group: 'termination', tone: 'warning', badge: 'Hết thời hạn thuê' },
  SETTLEMENT_RESPONSE_NEEDED: RESPOND('settlement', 'warning', 'Cần phản hồi'),
  SETTLEMENT_RESPONSE_OVERDUE: RESPOND('settlement', 'danger', 'Quá hạn phản hồi'),
  SETTLEMENT_PAYMENT_OVERDUE: { group: 'settlement', tone: 'danger', badge: 'Quá hạn thanh toán' },
  LEASE_CLOSED: { group: 'settlement', tone: 'primary', badge: 'Hồ sơ đã đóng' },
  COMPLAINT_OPENED: RESPOND('complaint', 'warning', 'Khiếu nại mới'),
  COMPLAINT_INFO_REQUESTED: RESPOND('complaint', 'warning', 'Cần bổ sung thông tin'),
  COMPLAINT_DECIDED: { group: 'complaint', tone: 'primary', badge: 'Đã có kết luận' },
  COMPLAINT_FINAL_DECISION: { group: 'complaint', tone: 'primary', badge: 'Kết luận lần cuối' },
  BRANCH_DAILY_DIGEST: { group: 'digest', tone: 'warning', badge: 'Việc cần chú ý' },
};

/** Fully-signed text adapts: only the lease email carries the bundle, the deposit one says it comes later. */
function fullySignedNote(ctx: EmailContext): string[] {
  // Core event data names `agreementKind`; the dispatcher gates the bundle on `agreementType`.
  const kind = pick(ctx.data, ['agreementType', 'agreementKind']);
  if (kind === 'LEASE') return ['Hợp đồng thuê và hợp đồng cọc đã ký được đính kèm trong email này.'];
  if (kind === 'DEPOSIT') return ['Hợp đồng cọc đã ký xong. Bản PDF sẽ được gửi kèm khi hợp đồng thuê hoàn tất.'];
  return [];
}

function rows(def: Def, ctx: EmailContext): [string, string][] {
  const d = ctx.data;
  const text = (keys: string[]) => {
    const v = pick(d, keys);
    return v === undefined ? undefined : String(v);
  };
  const digest = def.group === 'digest';
  const all: [string, string | undefined][] = [
    ['Số việc cần chú ý', digest ? text(['attentionCount']) : undefined],
    ['Mã hợp đồng', digest ? undefined : text(['contractNumber', 'contractCode', 'agreementNumber'])],
    ['Ngày hiệu lực', formatVnDate(pick(d, ['effectiveDate', 'effectiveFrom', 'startDate']), false)],
    ['Ngày kết thúc', formatVnDate(pick(d, ['endDate', 'leaseEndDate']), false)],
    [def.deadline ?? 'Hạn xử lý', formatVnDate(pick(d, ['dueAt', 'deadline', 'signingDeadline', 'responseDeadline', 'respondBy']), true)],
    ['Số tiền', formatVnd(pick(d, ['amount', 'totalAmount']))],
  ];
  return all.filter((r): r is [string, string] => !!r[1]);
}

function makeSpec(def: Def): EmailSpec {
  const digest = def.group === 'digest';
  const ctaLabel = def.group === 'complaint' ? 'Mở hồ sơ khiếu nại' : digest ? 'Xem việc cần chú ý' : 'Mở hợp đồng';
  return {
    policy: 'OPT_IN',
    ...(def.group === 'fully-signed' ? { attachments: ['LEASE_BUNDLE' as const] } : {}),
    render(ctx) {
      const detailRows = rows(def, ctx);
      return {
        subject: subjectOf(ctx.title),
        ...renderEmail({
          template: `contract/${def.group}`,
          baseUrl: ctx.baseUrl,
          // The digest follows the "Hệ thống" toggle (docs/notification-email/contract.md §4); everything else "Hợp đồng".
          category: digest ? 'Hệ thống' : 'Hợp đồng',
          preheader: ctx.body,
          heading: ctx.title,
          badge: { label: def.badge, tone: def.tone },
          bodyParagraphs: [ctx.body, ...(def.group === 'fully-signed' ? fullySignedNote(ctx) : [])].filter(Boolean),
          detailRows: detailRows.length ? detailRows : undefined,
          cta: ctx.actionUrl ? { label: ctaLabel, url: ctx.actionUrl } : undefined,
        }),
      };
    },
  };
}

/**
 * Contract-category emails (all OPT_IN; default ON is the dispatcher's job, digest default OFF).
 * Not covered on purpose: RENEWAL_APPROVED/TERMINATION_APPROVED (merged into later signing emails), informational
 * events and the dead CONTRACT_* events. COMPLAINT_* must only be dispatched for data.audience === 'PARTY'.
 */
export const contractEmails: CategoryEmails = Object.fromEntries(
  Object.entries(DEFS).map(([type, def]) => [type, makeSpec(def)]),
);
