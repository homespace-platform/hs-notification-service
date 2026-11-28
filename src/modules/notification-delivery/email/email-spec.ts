import type { EmailTone } from './render-email';

/**
 * Contract between the email dispatcher (generic) and per-category template modules
 * (`templates/<category>/index.ts`). Each category exports `Record<eventType, EmailSpec>`.
 * Plan and owner decisions: docs/notification_email.md and docs/notification-email/*.md.
 */

/** ALWAYS: sent even when the user turned Email off (legal/financial documents, security). OPT_IN: follows the category Email toggle. */
export type EmailPolicy = 'ALWAYS' | 'OPT_IN';

/** PDF files read from S3 through Core's internal document API (see docs/notification_email.md §Attachments). */
export type AttachmentKind =
  | 'RENTAL_RECEIPT' // payment receipt of a rental payment request
  | 'MEMBERSHIP_RECEIPT' // membership purchase receipt (by orderId)
  | 'OVERPAYMENT_RECEIPT' // membership overpayment receipt (by overpaymentId)
  | 'LEASE_BUNDLE'; // signed lease PDF + signed deposit agreement PDF of the same rental, sent together

/** Data the dispatcher gives a template: the persisted in-app notification plus allow-listed event data. */
export interface EmailContext {
  eventType: string;
  /** In-app title/body already rendered by notification-event.ts (Vietnamese, user-specific). */
  title: string;
  body: string;
  /** Absolute web URL built from MAIL_APP_BASE_URL + the notification actionPath. */
  actionUrl: string;
  baseUrl: string;
  /** Event `data` as stored on the notification (ids, amounts, dates, labels). Never contains secrets. */
  data: Readonly<Record<string, unknown>>;
  occurredAt: Date;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailSpec {
  policy: EmailPolicy;
  /** Optional files; the dispatcher fetches them before sending and retries while Core reports "not ready". */
  attachments?: AttachmentKind[];
  render(ctx: EmailContext): RenderedEmail;
}

export type CategoryEmails = Readonly<Record<string, EmailSpec>>;

/** Shared helpers so every category formats the same way. */
export const SUBJECT_PREFIX = '[HomeSpace] ';
export const subjectOf = (title: string): string => `${SUBJECT_PREFIX}${title.replace(/[\r\n]+/g, ' ').trim()}`;
export type { EmailTone };
