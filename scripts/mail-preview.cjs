// Writes one sample system-broadcast email per level to ./mail-preview (gitignored). Usage: npm run build && npm run mail:preview
const fs = require('node:fs');
const {
  renderSystemBroadcastEmail,
} = require('../dist/modules/notification-delivery/email/templates/system-broadcast.template');

const baseUrl = process.env.MAIL_APP_BASE_URL || 'https://homespace.id.vn';
fs.mkdirSync('mail-preview', { recursive: true });
for (const [priority, name] of [
  ['NORMAL', 'normal'],
  ['HIGH', 'important'],
  ['URGENT', 'urgent'],
]) {
  const mail = renderSystemBroadcastEmail({
    title: 'Bảo trì hệ thống lúc 23:00 tối nay',
    body: 'HomeSpace sẽ bảo trì khoảng 30 phút.\nXin lỗi vì sự bất tiện này.',
    priority,
    baseUrl,
  });
  fs.writeFileSync(`mail-preview/${name}.html`, mail.html);
  console.log(`mail-preview/${name}.html  (${mail.subject})`);
}
