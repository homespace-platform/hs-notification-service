/**
 * Shared HomeSpace email layout. Every module email (system broadcast, billing, contract, KYC, listing...)
 * builds its own module template that only fills this layout via renderEmail().
 * Table-based, inline CSS, 600px max, explicit bgcolor/color on every block so dark-mode clients cannot
 * make text vanish. No scripts; the only remote asset is the logo PNG on the public site.
 */
export type EmailTone = 'primary' | 'warning' | 'danger';

export interface EmailLayoutInput {
  /** Public site origin without trailing slash, e.g. https://homespace.id.vn (logo + settings link). */
  baseUrl: string;
  /** Hidden inbox preview text. */
  preheader: string;
  heading: string;
  /** Level/category chip shown above the heading; tone picks its colour. */
  badge?: { label: string; tone: EmailTone };
  /** Plain text paragraphs; escaped, newlines become line breaks. */
  bodyParagraphs: string[];
  detailRows?: [label: string, value: string][];
  cta?: { label: string; url: string };
  footerNote?: string;
  /** Category name used in "why you got this email", e.g. "Hệ thống". */
  category: string;
}

export const BRAND_PRIMARY = '#2563eb';
export const BRAND_DARK = '#163b70';
export const LOGO_PATH = '/logo/homespace-horizontal-logo-removebg.png';
export const SETTINGS_PATH = '/settings/notifications';
const TONES: Record<EmailTone, { fg: string; bg: string }> = {
  primary: { fg: BRAND_PRIMARY, bg: '#dbeafe' },
  warning: { fg: '#92400e', bg: '#fef3c7' },
  danger: { fg: '#b91c1c', bg: '#fee2e2' },
};
const FONT = 'font-family:Arial,Helvetica,sans-serif;';

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const multiline = (value: string): string =>
  escapeHtml(value).replace(/\r?\n/g, '<br>');
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

export function renderEmail(input: EmailLayoutInput): {
  html: string;
  text: string;
} {
  const { baseUrl } = input;
  const settingsUrl = `${baseUrl}${SETTINGS_PATH}`;
  const why = `Bạn nhận email này vì đã bật Email cho mục ${input.category} trong Cài đặt → Thông báo.`;
  const autoNote = 'Đây là email tự động, vui lòng không trả lời.';
  const tone = TONES[input.badge?.tone ?? 'primary'];

  const badge = input.badge
    ? `<tr><td style="padding:0 0 12px;"><span style="${FONT}display:inline-block;background-color:${tone.bg};color:${tone.fg};font-size:12px;font-weight:bold;line-height:16px;padding:4px 10px;border-radius:12px;">${escapeHtml(input.badge.label)}</span></td></tr>`
    : '';
  const paragraphs = input.bodyParagraphs
    .map(
      (p) =>
        `<tr><td style="${FONT}font-size:15px;line-height:24px;color:#1f2937;padding:0 0 14px;">${multiline(p)}</td></tr>`,
    )
    .join('');
  const rows = input.detailRows?.length
    ? `<tr><td style="padding:4px 0 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6" style="background-color:#f3f4f6;border-radius:8px;">${input.detailRows
        .map(
          ([label, value]) =>
            `<tr><td style="${FONT}font-size:13px;line-height:20px;color:#6b7280;padding:8px 12px;width:38%;" valign="top">${escapeHtml(label)}</td><td style="${FONT}font-size:14px;line-height:20px;color:#111827;font-weight:bold;padding:8px 12px;" valign="top">${escapeHtml(value)}</td></tr>`,
        )
        .join('')}</table></td></tr>`
    : '';
  // Bulletproof button: padded table cell with bgcolor, so Outlook keeps the fill.
  const cta = input.cta
    ? `<tr><td style="padding:6px 0 18px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${BRAND_PRIMARY}" style="background-color:${BRAND_PRIMARY};border-radius:8px;"><a href="${escapeHtml(input.cta.url)}" target="_blank" style="${FONT}display:inline-block;padding:12px 24px;font-size:15px;font-weight:bold;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(input.cta.label)}</a></td></tr></table></td></tr>`
    : '';
  const note = input.footerNote
    ? `<tr><td style="${FONT}font-size:13px;line-height:20px;color:#6b7280;padding:0 0 14px;">${multiline(input.footerNote)}</td></tr>`
    : '';

  const html = `<!doctype html>
<html lang="vi" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${escapeHtml(oneLine(input.heading))}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;" bgcolor="#f1f5f9">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#f1f5f9;">${escapeHtml(oneLine(input.preheader))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5f9" style="background-color:#f1f5f9;"><tr><td align="center" style="padding:16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:12px;border-top:4px solid ${BRAND_PRIMARY};">
<tr><td style="padding:24px 28px 8px;"><a href="${escapeHtml(baseUrl)}" target="_blank"><img src="${escapeHtml(baseUrl + LOGO_PATH)}" width="160" alt="HomeSpace" style="display:block;border:0;outline:none;width:160px;height:auto;color:${BRAND_DARK};${FONT}font-size:18px;font-weight:bold;"></a></td></tr>
<tr><td style="padding:16px 28px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${badge}<tr><td style="${FONT}font-size:22px;line-height:30px;font-weight:bold;color:${BRAND_DARK};padding:0 0 14px;">${escapeHtml(oneLine(input.heading))}</td></tr>${paragraphs}${rows}${cta}${note}</table></td></tr>
<tr><td style="padding:8px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table></td></tr>
<tr><td style="${FONT}padding:16px 28px 24px;font-size:12px;line-height:18px;color:#6b7280;"><strong style="color:${BRAND_DARK};">HomeSpace – Tìm nơi ở lý tưởng</strong><br>${escapeHtml(why)} <a href="${escapeHtml(settingsUrl)}" target="_blank" style="color:${BRAND_PRIMARY};">Thay đổi cài đặt</a><br>${autoNote}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    oneLine(input.heading),
    input.badge ? `[${input.badge.label}]` : '',
    ...input.bodyParagraphs,
    input.detailRows?.map(([l, v]) => `${l}: ${v}`).join('\n') ?? '',
    input.cta ? `${input.cta.label}: ${input.cta.url}` : '',
    input.footerNote ?? '',
    `--\nHomeSpace – Tìm nơi ở lý tưởng\n${why}\nThay đổi cài đặt: ${settingsUrl}\n${autoNote}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { html, text };
}
