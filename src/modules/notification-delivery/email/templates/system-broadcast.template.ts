import { type EmailTone, renderEmail } from './email-layout';

const LEVELS: Record<
  string,
  { prefix: string; badge: { label: string; tone: EmailTone } }
> = {
  HIGH: { prefix: '[Quan trọng] ', badge: { label: 'Quan trọng', tone: 'warning' } },
  URGENT: { prefix: '[Khẩn cấp] ', badge: { label: 'Khẩn cấp', tone: 'danger' } },
};

/** Module template: admin "Thông báo hệ thống" broadcast (category Hệ thống). */
export function renderSystemBroadcastEmail(input: {
  title: string;
  body: string;
  priority: string;
  baseUrl: string;
}): { subject: string; html: string; text: string } {
  const title = input.title.replace(/[\r\n]+/g, ' ').trim();
  const level = LEVELS[input.priority];
  return {
    subject: `[HomeSpace] ${level?.prefix ?? ''}${title}`,
    ...renderEmail({
      baseUrl: input.baseUrl,
      category: 'Hệ thống',
      preheader: input.body,
      heading: title,
      badge: level?.badge ?? { label: 'Thông báo hệ thống', tone: 'primary' },
      bodyParagraphs: [input.body],
      cta: { label: 'Mở HomeSpace', url: input.baseUrl },
    }),
  };
}
