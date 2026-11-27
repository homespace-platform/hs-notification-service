import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadTemplates, render, TEMPLATES, TEMPLATES_DIR } from './template-engine';
import { renderEmail } from './render-email';
import { renderSystemBroadcastEmail } from './templates/system';

const BASE = 'https://homespace.id.vn';

describe('template engine', () => {
  it('loads every template once, components as partials, strict on missing data', () => {
    for (const key of ['layout/base', 'system/broadcast', 'components/button', 'components/badge', 'components/footer'])
      expect(TEMPLATES.has(key)).toBe(true);
    expect(() => render(TEMPLATES, 'components/button', { label: 'x' })).toThrow();
    expect(() => render(TEMPLATES, 'nope', {})).toThrow('not found');
  });
  it('escapes user data by default', () => {
    expect(render(TEMPLATES, 'components/heading', { heading: '<&>' })).toContain('&lt;&amp;&gt;');
  });
  it('fails clearly when the directory is missing', () => {
    expect(() => loadTemplates(join(TEMPLATES_DIR, 'does-not-exist'))).toThrow('missing or unreadable');
  });
  it('has a README for every category folder that has no template yet', () => {
    for (const d of ['account', 'listing', 'appointment', 'contract', 'payment', 'chat', 'rental-request', 'news'])
      expect(existsSync(join(TEMPLATES_DIR, d, 'README.md'))).toBe(true);
  });
});

describe('renderEmail (shared layout)', () => {
  const out = renderEmail({
    template: 'system/broadcast',
    baseUrl: BASE,
    category: 'Hợp đồng',
    preheader: 'Xem trước',
    heading: 'Tiêu đề <b>',
    badge: { label: 'Khẩn cấp', tone: 'danger' },
    bodyParagraphs: ['Dòng 1\nDòng 2 & "x"'],
    detailRows: [['Mã', '<A1>']],
    cta: { label: 'Mở', url: `${BASE}/x?a=1&b=2` },
    footerNote: 'Ghi chú',
  });

  it('has logo, bulletproof CTA, footer and escaped content', () => {
    expect(out.html).toContain(`src="${BASE}/logo/homespace-horizontal-logo-removebg.png"`);
    expect(out.html).toContain('alt="HomeSpace"');
    expect(out.html).toContain('width="600"');
    expect(out.html).toContain('bgcolor="#2563eb"');
    expect(out.html).toContain('href="https://homespace.id.vn/x?a&#x3D;1&amp;b&#x3D;2"');
    expect(out.html).toContain('Tiêu đề &lt;b&gt;');
    expect(out.html).toContain('Dòng 1<br>Dòng 2 &amp; &quot;x&quot;');
    expect(out.html).toContain('&lt;A1&gt;');
    expect(out.html).toContain('#b91c1c');
    expect(out.html).toContain('HomeSpace – Tìm nơi ở lý tưởng');
    expect(out.html).toContain('đã bật Email cho mục Hợp đồng trong Cài đặt → Thông báo');
    expect(out.html).toContain(`${BASE}/settings/notifications`);
    expect(out.html).toContain('Đây là email tự động, vui lòng không trả lời.');
    expect(out.html).not.toMatch(/<script|<b>|\{\{/);
  });

  it('builds the plain-text alternative from the same data', () => {
    expect(out.text).toContain('Dòng 1\nDòng 2 & "x"');
    expect(out.text).toContain('Mã: <A1>');
    expect(out.text).toContain(`Mở: ${BASE}/x?a=1&b=2`);
    expect(out.text).toContain('Đây là email tự động');
  });
});

describe('renderSystemBroadcastEmail', () => {
  const mail = (priority: string) =>
    renderSystemBroadcastEmail({ title: 'Bảo trì\r\nX', body: '<img src=x onerror=1>', priority, baseUrl: BASE });
  it('prefixes the subject by level and escapes user text', () => {
    expect(mail('NORMAL').subject).toBe('[HomeSpace] Bảo trì X');
    expect(mail('HIGH').subject).toBe('[HomeSpace] [Quan trọng] Bảo trì X');
    expect(mail('URGENT').subject).toBe('[HomeSpace] [Khẩn cấp] Bảo trì X');
    expect(mail('URGENT').html).not.toContain('<img src=x');
    expect(mail('HIGH').html).toContain('#92400e');
    expect(mail('NORMAL').html).toContain('Mở HomeSpace');
  });
});
