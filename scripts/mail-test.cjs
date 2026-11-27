// Sends one test email via Resend. Usage: npm run build && npm run mail:test -- <to>
require('reflect-metadata');
const { ConfigService } = require('@nestjs/config');
const { EmailProvider } = require('../dist/modules/notification-delivery/email.provider');

async function main() {
  const to = process.argv[2];
  if (!to) throw new Error('Usage: npm run mail:test -- <to>');
  const provider = new EmailProvider(new ConfigService(process.env));
  if (!provider.enabled) throw new Error('MAIL_RESEND_API_KEY is blank; email channel is disabled');
  const id = await provider.sendEmail({
    to,
    subject: 'HomeSpace test email',
    text: 'Email test from hs-notification-service.',
    html: '<p>Email test from hs-notification-service.</p>',
  });
  console.log(`Sent. Resend id: ${id}`);
}
main().catch((e) => {
  console.error(`Failed${e.retryable ? ' (retryable)' : ''}: ${e.message}`);
  process.exit(1);
});
