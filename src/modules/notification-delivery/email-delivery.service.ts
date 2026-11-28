import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as delay } from 'node:timers/promises';
import type { NotificationRecord } from '../notification/domain/notification.model';
import { DocumentClient, documentTarget } from './core-document.client';
import { emailSpecFor } from './email/email-registry';
import type { EmailContext, EmailSpec } from './email/email-spec';
import { EMAIL_MAX_ATTEMPTS, EmailOutbox, type EmailJob } from './email-outbox';
import {
  type EmailAttachment,
  EmailProvider,
  EmailSendError,
} from './email.provider';
import { UserEmailDirectory } from './user-email.directory';

/** Resend allows 2 requests/second by default. */
export const EMAIL_SEND_INTERVAL_MS = 500;
/** Resend caps a message at 40 MB after base64; stay below it (counted on the base64 text) and send without files instead of failing. */
export const MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024;
/** A PDF that Core reports as not ready is retried for this long, then the email goes out without it. */
export const ATTACHMENT_WAIT_MS = 30 * 60_000;
export const ATTACHMENT_NOTE =
  'Không đính kèm được tệp PDF lần này. Bạn có thể tải trong HomeSpace.';
const BATCH = 20;
const LEASE_MS = 600_000;
const notReadyDelay = (elapsedMs: number) =>
  Math.min(Math.max(elapsedMs, 30_000), 300_000);
const retryDelay = (attempt: number) =>
  Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);
/** Keeps a plain file name: no path separators or control characters. */
const safeFileName = (name: string): string =>
  // eslint-disable-next-line no-control-regex -- strip control characters from provider-supplied names.
  name.replace(/[\\/\u0000-\u001f]+/g, '_').trim().slice(0, 150) ||
  'document.pdf';

/**
 * Durable, throttled email dispatcher for every event type that has an EmailSpec. Runs off the request/Kafka path:
 * enqueue only writes a job row (with everything needed to render); sending happens on a timer.
 * Push/realtime never wait on it.
 */
@Injectable()
export class EmailDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailDeliveryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopping = false;
  private lastSendAt = 0;
  private activeTick?: Promise<void>;
  /** Overridable in tests. */
  sleep: (ms: number) => Promise<unknown> = (ms) => delay(ms);
  now: () => number = () => Date.now();

  constructor(
    private readonly outbox: EmailOutbox,
    private readonly provider: EmailProvider,
    private readonly directory: UserEmailDirectory,
    private readonly documents: DocumentClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.activeTick = this.tick();
    }, 5000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.activeTick;
  }

  /**
   * Stores a job when the event type has an email spec and policy allows it: ALWAYS ignores the user toggle,
   * OPT_IN follows the toggle of the notification's category. Legacy backfill events and admin-audience complaints never email.
   */
  async enqueue(n: NotificationRecord): Promise<void> {
    const spec = emailSpecFor(n.type);
    if (!spec || !this.provider.enabled || n.metadata?.legacy === true) return;
    if (n.type.startsWith('COMPLAINT_') && n.metadata?.audience === 'ADMIN') return;
    // Complaint emails say "Hợp đồng", so they follow that toggle (their in-app category is RENTAL_REQUEST).
    const category = n.type.startsWith('COMPLAINT_') ? 'CONTRACT' : n.category;
    if (spec.policy === 'OPT_IN' && !(await this.outbox.optedIn(n.recipientId, category))) return;
    await this.outbox.add({
      notificationId: n.id,
      recipientId: n.recipientId,
      category,
      eventType: n.type,
      title: n.title,
      body: n.body,
      priority: n.priority,
      actionPath: n.actionPath,
      data: n.metadata ?? {},
      occurredAt: n.createdAt,
    });
  }

  async tick(): Promise<void> {
    if (this.running || this.stopping || !this.provider.enabled) return;
    this.running = true;
    const counts = { sent: 0, skipped: 0, failed: 0, retry: 0 };
    try {
      for (;;) {
        const jobs = await this.outbox.claim(
          BATCH,
          new Date(this.now()),
          new Date(this.now() + LEASE_MS),
        );
        if (!jobs.length) break;
        let addresses: Map<string, string>;
        try {
          addresses = await this.directory.resolve(
            jobs.map((j) => j.recipientId),
          );
        } catch {
          for (const job of jobs)
            await this.retryOrFail(job, 'directory-unavailable', true, counts);
          break;
        }
        for (const job of jobs) {
          if (this.stopping) return;
          await this.process(job, addresses.get(job.recipientId), counts);
        }
      }
    } catch {
      this.logger.warn(
        'Email dispatcher unavailable; persisted work will be retried',
      );
    } finally {
      this.running = false;
      if (counts.sent + counts.skipped + counts.failed + counts.retry > 0)
        this.logger.log(
          `Email batch: sent=${counts.sent} skipped=${counts.skipped} failed=${counts.failed} retry=${counts.retry}`,
        );
    }
  }

  private async process(
    job: EmailJob,
    address: string | undefined,
    counts: Record<string, number>,
  ): Promise<void> {
    const spec = emailSpecFor(job.eventType);
    const skip = !spec
      ? 'no-spec'
      : !address
        ? 'no-address'
        : spec.policy === 'OPT_IN' &&
            !(await this.outbox.optedIn(job.recipientId, job.category))
          ? 'opted-out'
          : null;
    if (skip || !spec || !address) {
      counts.skipped++;
      return this.outbox.finish(job, {
        status: 'skipped',
        errorCode: skip ?? undefined,
      });
    }
    let attachments: EmailAttachment[] = [];
    let note: string | undefined;
    if (spec.attachments?.length) {
      try {
        const result = await this.collectAttachments(job, spec);
        if (result === 'not-ready') {
          counts.retry++;
          return this.outbox.finish(job, {
            status: 'pending',
            errorCode: 'attachment-not-ready',
            nextAttemptAt: new Date(
              this.now() + notReadyDelay(this.now() - job.createdAt.getTime()),
            ),
            refundAttempt: true,
          });
        }
        ({ attachments, note } = result);
      } catch {
        // Core unreachable or failing: retry; on the last attempt send without the file rather than lose the email.
        if (job.attempts < EMAIL_MAX_ATTEMPTS)
          return this.retryOrFail(job, 'document-unavailable', true, counts);
        note = ATTACHMENT_NOTE;
      }
    }
    const wait = this.lastSendAt + EMAIL_SEND_INTERVAL_MS - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastSendAt = this.now();
    try {
      const mail = spec.render(this.context(job));
      const id = await this.provider.sendEmail({
        to: address,
        ...mail,
        ...(note ? withNote(mail, note) : {}),
        ...(attachments.length ? { attachments } : {}),
        idempotencyKey: job.notificationId,
      });
      counts.sent++;
      await this.outbox.finish(job, { status: 'sent', providerMessageId: id });
    } catch (error) {
      const known = error instanceof EmailSendError;
      await this.retryOrFail(
        job,
        known && error.status ? `http-${error.status}` : 'send-failed',
        known ? error.retryable : true,
        counts,
      );
    }
  }

  private context(job: EmailJob): EmailContext {
    const baseUrl = this.config.getOrThrow<string>('MAIL_APP_BASE_URL');
    return {
      eventType: job.eventType,
      title: job.title,
      body: job.body,
      actionUrl: `${baseUrl}${job.actionPath ?? '/notifications'}`,
      baseUrl,
      data: job.data,
      occurredAt: job.occurredAt,
      priority: job.priority,
    };
  }

  /** Files for the email, 'not-ready' to wait, or no files plus a note when a document will not arrive. Throws to retry. */
  private async collectAttachments(
    job: EmailJob,
    spec: EmailSpec,
  ): Promise<'not-ready' | { attachments: EmailAttachment[]; note?: string }> {
    const attachments: EmailAttachment[] = [];
    let missing = false;
    for (const kind of spec.attachments ?? []) {
      const target = documentTarget(kind, job.data);
      if (target === 'skip') continue;
      if (target === 'missing') {
        missing = true;
        continue;
      }
      const result = await this.documents.fetch(
        target.path,
        target.id,
        job.recipientId,
      );
      if (result.outcome === 'ok') {
        attachments.push(
          ...result.files.map((f) => ({
            filename: safeFileName(f.fileName),
            content: f.contentBase64,
          })),
        );
      } else if (
        result.outcome === 'not-ready' &&
        this.now() - job.createdAt.getTime() < ATTACHMENT_WAIT_MS
      ) {
        return 'not-ready';
      } else {
        missing = true;
      }
    }
    const size = attachments.reduce((sum, a) => sum + a.content.length, 0);
    // One missing or oversized file drops all of them: a partial legal bundle would mislead.
    if (missing || size > MAX_ATTACHMENT_BYTES)
      return { attachments: [], note: ATTACHMENT_NOTE };
    return { attachments };
  }

  private async retryOrFail(
    job: EmailJob,
    errorCode: string,
    retryable: boolean,
    counts: Record<string, number>,
  ): Promise<void> {
    if (retryable && job.attempts < EMAIL_MAX_ATTEMPTS) {
      counts.retry++;
      return this.outbox.finish(job, {
        status: 'pending',
        errorCode,
        nextAttemptAt: new Date(this.now() + retryDelay(job.attempts)),
      });
    }
    counts.failed++;
    return this.outbox.finish(job, { status: 'failed', errorCode });
  }
}

/** Appends a visible note to an already rendered email (html before the footer-agnostic end of body, text at the end). */
function withNote(
  mail: { html: string; text: string },
  note: string,
): { html: string; text: string } {
  const escaped = note.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const block = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#92400e;background-color:#fef3c7;padding:12px 16px;margin:12px auto;max-width:600px;border-radius:8px;" bgcolor="#fef3c7">${escaped}</div>`;
  const html = mail.html.includes('</body>')
    ? mail.html.replace('</body>', `${block}</body>`)
    : mail.html + block;
  return { html, text: `${mail.text}\n\n${note}` };
}
