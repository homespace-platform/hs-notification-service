import type { CategoryEmails, EmailSpec } from './email-spec';
import { contractEmails } from './templates/contract';
import { paymentEmails } from './templates/payment';
import { renderSystemBroadcastEmail } from './templates/system';

/** Admin "Thông báo hệ thống" broadcast: opt-in, default off. */
const systemEmails: CategoryEmails = {
  PLATFORM_ANNOUNCEMENT: {
    policy: 'OPT_IN',
    render: (ctx) => renderSystemBroadcastEmail({ title: ctx.title, body: ctx.body, priority: ctx.priority ?? 'NORMAL', baseUrl: ctx.baseUrl }),
  },
};

/** Event types that never produce email even if a category registers them (fines grow daily). */
const NEVER_EMAIL: ReadonlySet<string> = new Set(['INVOICE_AMOUNT_UPDATED']);

const SPECS: CategoryEmails = { ...systemEmails, ...paymentEmails, ...contractEmails };

/** The email spec of an event type, or undefined when that event never sends email. */
export const emailSpecFor = (eventType: string): EmailSpec | undefined =>
  !NEVER_EMAIL.has(eventType) && Object.hasOwn(SPECS, eventType) ? SPECS[eventType] : undefined;
