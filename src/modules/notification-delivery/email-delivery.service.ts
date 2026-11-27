import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as delay } from 'node:timers/promises';
import { renderSystemBroadcastEmail } from './email/templates/system-broadcast.template';
import { EMAIL_MAX_ATTEMPTS, EmailOutbox, type EmailJob } from './email-outbox';
import { EmailProvider, EmailSendError } from './email.provider';
import { UserEmailDirectory } from './user-email.directory';

/** Resend allows 2 requests/second by default. */
export const EMAIL_SEND_INTERVAL_MS = 500;
const BATCH = 20;
const LEASE_MS = 600_000;
const retryDelay = (attempt: number) =>
  Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);

/**
 * Durable, throttled email dispatcher for SYSTEM broadcasts. Runs off the request/Kafka path:
 * enqueue only writes a job row; sending happens on a timer. Push/realtime never wait on it.
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

  /** No job is stored when email is off or the user has not opted in. */
  async enqueue(notificationId: string, recipientId: string): Promise<void> {
    if (!this.provider.enabled || !(await this.outbox.optedIn(recipientId)))
      return;
    await this.outbox.add(notificationId, recipientId);
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
    const content = await this.outbox.content(job);
    const skip = !content
      ? 'notification-missing'
      : !address
        ? 'no-address'
        : !(await this.outbox.optedIn(job.recipientId))
          ? 'opted-out'
          : null;
    if (skip || !content || !address) {
      counts.skipped++;
      return this.outbox.finish(job, {
        status: 'skipped',
        errorCode: skip ?? undefined,
      });
    }
    const wait = this.lastSendAt + EMAIL_SEND_INTERVAL_MS - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastSendAt = this.now();
    try {
      const mail = renderSystemBroadcastEmail({
        ...content,
        baseUrl: this.config.getOrThrow<string>('MAIL_APP_BASE_URL'),
      });
      const id = await this.provider.sendEmail({
        to: address,
        ...mail,
        idempotencyKey: `${content.sourceEventId.replace(/^admin_/, '')}:${job.recipientId}`,
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
