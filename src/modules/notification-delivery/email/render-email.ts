import { render, TEMPLATES } from './template-engine';

/**
 * Shared email API. A module template (templates/<category>/<name>.hbs) renders the body
 * and layout/base.hbs wraps it (logo, footer). All user text is escaped by Handlebars.
 */
export type EmailTone = 'primary' | 'warning' | 'danger';

export interface EmailInput {
  /** Module template key, e.g. `system/broadcast`. */
  template: string;
  /** Public site origin without trailing slash, e.g. https://homespace.id.vn. */
  baseUrl: string;
  /** Category name for "why you got this email", e.g. "Hệ thống". */
  category: string;
  preheader: string;
  heading: string;
  badge?: { label: string; tone: EmailTone };
  bodyParagraphs: string[];
  detailRows?: [label: string, value: string][];
  cta?: { label: string; url: string };
  footerNote?: string;
}

export const LOGO_PATH = '/logo/homespace-horizontal-logo-removebg.png';
export const SETTINGS_PATH = '/settings/notifications';
const TONES: Record<EmailTone, { fg: string; bg: string }> = {
  primary: { fg: '#2563eb', bg: '#dbeafe' },
  warning: { fg: '#92400e', bg: '#fef3c7' },
  danger: { fg: '#b91c1c', bg: '#fee2e2' },
};

const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();
const lines = (value: string) => ({ lines: value.split(/\r?\n/) });

export function renderEmail(input: EmailInput): { html: string; text: string } {
  const settingsUrl = `${input.baseUrl}${SETTINGS_PATH}`;
  const heading = oneLine(input.heading);
  // Every key is always present: strict mode throws on missing variables.
  const shared = {
    heading,
    category: input.category,
    baseUrl: input.baseUrl,
    settingsUrl,
    badge: input.badge ? { label: input.badge.label, ...TONES[input.badge.tone] } : null,
    paragraphs: input.bodyParagraphs.map(lines),
    detailRows: (input.detailRows ?? []).map(([label, value]) => ({ label, value })),
    cta: input.cta ?? null,
    footerNote: input.footerNote ? lines(input.footerNote) : null,
  };
  const html = render(TEMPLATES, 'layout/base', {
    ...shared,
    title: heading,
    preheader: oneLine(input.preheader),
    logoUrl: `${input.baseUrl}${LOGO_PATH}`,
    content: render(TEMPLATES, input.template, shared),
  });
  const text = [
    heading,
    input.badge ? `[${input.badge.label}]` : '',
    ...input.bodyParagraphs,
    input.detailRows?.map(([l, v]) => `${l}: ${v}`).join('\n') ?? '',
    input.cta ? `${input.cta.label}: ${input.cta.url}` : '',
    input.footerNote ?? '',
    `--\nHomeSpace – Tìm nơi ở lý tưởng\nBạn nhận email này vì đã bật Email cho mục ${input.category} trong Cài đặt → Thông báo.\nThay đổi cài đặt: ${settingsUrl}\nĐây là email tự động, vui lòng không trả lời.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { html, text };
}
