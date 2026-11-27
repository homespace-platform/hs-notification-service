import { type EmailTone, renderEmail } from '../../render-email';

const LEVELS: Record<string, { prefix: string; badge: { label: string; tone: EmailTone } }> = {
  HIGH: { prefix: '[Quan trọng] ', badge: { label: 'Quan trọng', tone: 'warning' } },
  URGENT: { prefix: '[Khẩn cấp] ', badge: { label: 'Khẩn cấp', tone: 'danger' } },
};

/** Subject lives next to broadcast.html. */
export const systemBroadcastSubject = (title: string, priority: string): string =>
  `[HomeSpace] ${LEVELS[priority]?.prefix ?? ''}${title.replace(/[\r\n]+/g, ' ').trim()}`;

/** Admin "Thông báo hệ thống" broadcast (category Hệ thống). */
export function renderSystemBroadcastEmail(input: {
  title: string;
  body: string;
  priority: string;
  baseUrl: string;
}): { subject: string; html: string; text: string } {
  return {
    subject: systemBroadcastSubject(input.title, input.priority),
    ...renderEmail({
      template: 'system/broadcast',
      baseUrl: input.baseUrl,
      category: 'Hệ thống',
      preheader: input.body,
      heading: input.title,
      badge: LEVELS[input.priority]?.badge ?? { label: 'Thông báo hệ thống', tone: 'primary' },
      bodyParagraphs: [input.body],
      cta: { label: 'Mở HomeSpace', url: input.baseUrl },
    }),
  };
}
