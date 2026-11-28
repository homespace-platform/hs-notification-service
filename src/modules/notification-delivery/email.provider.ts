import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** `content` is base64; Resend caps a message (after encoding) at 40 MB. */
export interface EmailAttachment {
  filename: string;
  content: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  idempotencyKey?: string;
  tags?: { name: string; value: string }[];
  attachments?: EmailAttachment[];
}

/** `retryable` is true for 429, 5xx, timeouts and network errors; false for 4xx and invalid input. */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

export const maskEmail = (address: string): string => {
  const at = address.lastIndexOf('@');
  return at < 1 ? '***' : `${address[0]}***${address.slice(at)}`;
};

@Injectable()
export class EmailProvider implements OnModuleInit {
  private readonly logger = new Logger(EmailProvider.name);
  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return !!this.config.get<string>('MAIL_RESEND_API_KEY')?.trim();
  }

  onModuleInit(): void {
    if (this.enabled) this.logger.log('Email channel enabled (Resend)');
    else this.logger.warn('Email channel disabled: MAIL_RESEND_API_KEY is blank');
  }

  /** Returns the Resend email id. */
  async sendEmail(input: SendEmailInput): Promise<string> {
    if (!this.enabled) throw new EmailSendError('Email disabled', false);
    const to = input.to?.trim();
    if (!to || !EMAIL_RE.test(to)) throw new EmailSendError('Invalid recipient email', false);
    if (!input.subject?.trim()) throw new EmailSendError('Subject is required', false);
    if (!input.html?.trim() && !input.text?.trim()) throw new EmailSendError('html or text is required', false);

    const key = this.config.get<string>('MAIL_RESEND_API_KEY')!.trim();
    const address = this.config.get<string>('MAIL_FROM_ADDRESS')?.trim();
    const name = this.config.get<string>('MAIL_FROM_NAME')?.trim();
    if (!address) throw new EmailSendError('MAIL_FROM_ADDRESS is not configured', false);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
    if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;

    const masked = maskEmail(to);
    let res: Response;
    try {
      res = await fetch(RESEND_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: name ? `${name} <${address}>` : address,
          to: [to],
          subject: input.subject,
          html: input.html,
          text: input.text,
          tags: input.tags,
          attachments: input.attachments?.length ? input.attachments : undefined,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = (error as Error)?.name === 'TimeoutError';
      this.logger.warn(`Email to ${masked} failed: ${timedOut ? 'timeout' : 'network error'}`);
      throw new EmailSendError(timedOut ? 'Resend request timed out' : 'Resend network error', true);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      this.logger.warn(`Email to ${masked} rejected: HTTP ${res.status}${retryable ? ' (retryable)' : ''}`);
      throw new EmailSendError(body.message || `Resend HTTP ${res.status}`, retryable, res.status);
    }
    if (!body.id) throw new EmailSendError('Resend response missing id', true, res.status);
    this.logger.log(`Email sent to ${masked} id=${body.id}`);
    return body.id;
  }
}
