import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import {
  EMAIL_SEND_INTERVAL_MS,
  EmailDeliveryService,
} from './email-delivery.service';
import {
  EMAIL_MAX_ATTEMPTS,
  EmailOutbox,
  type EmailContent,
  type EmailJob,
  type EmailJobPatch,
} from './email-outbox';
import {
  EmailProvider,
  EmailSendError,
  type SendEmailInput,
} from './email.provider';
import {
  CoreUserEmailDirectory,
  UserEmailDirectory,
} from './user-email.directory';

type Row = EmailJob & { status: string; due: number; errorCode?: string };

class MemOutbox extends EmailOutbox {
  jobs = new Map<string, Row>();
  opted = new Set<string>();
  contents = new Map<string, EmailContent>();
  async add(id: string, recipientId: string) {
    if (!this.jobs.has(id))
      this.jobs.set(id, {
        notificationId: id,
        recipientId,
        attempts: 0,
        status: 'pending',
        due: 0,
      });
  }
  async claim(limit: number, now: Date) {
    const out: EmailJob[] = [];
    for (const j of this.jobs.values()) {
      if (
        out.length < limit &&
        j.status === 'pending' &&
        j.attempts < EMAIL_MAX_ATTEMPTS &&
        j.due <= now.getTime()
      ) {
        j.status = 'processing';
        j.attempts++;
        out.push({
          notificationId: j.notificationId,
          recipientId: j.recipientId,
          attempts: j.attempts,
        });
      }
    }
    return out;
  }
  async finish(job: EmailJob, p: EmailJobPatch) {
    const j = this.jobs.get(job.notificationId)!;
    j.status = p.status;
    j.errorCode = p.errorCode;
    j.due = p.nextAttemptAt?.getTime() ?? 0;
  }
  async content(job: EmailJob) {
    return this.contents.get(job.notificationId) ?? null;
  }
  async optedIn(userId: string) {
    return this.opted.has(userId);
  }
}

const BASE = 'https://homespace.id.vn';
function setup(over: { enabled?: boolean } = {}) {
  const outbox = new MemOutbox();
  const sent: SendEmailInput[] = [];
  const provider = {
    enabled: over.enabled ?? true,
    sendEmail: jest.fn(async (i: SendEmailInput) => {
      sent.push(i);
      return `em_${sent.length}`;
    }),
  };
  const emails = new Map<string, string>();
  const directory: UserEmailDirectory = {
    resolve: async (ids) =>
      new Map(
        ids.filter((i) => emails.has(i)).map((i) => [i, emails.get(i)!]),
      ),
  };
  const service = new EmailDeliveryService(
    outbox,
    provider as unknown as EmailProvider,
    directory,
    new ConfigService({ MAIL_APP_BASE_URL: BASE }),
  );
  let clock = 1_000_000;
  const sleeps: number[] = [];
  service.now = () => clock;
  service.sleep = async (ms) => {
    sleeps.push(ms);
    clock += ms;
  };
  const user = (id: string, opted: boolean, email: string | null = `${id}@example.com`) => {
    if (opted) outbox.opted.add(id);
    if (email) emails.set(id, email);
    outbox.contents.set(`n-${id}`, {
      sourceEventId: 'admin_bc1',
      title: 'T <x>',
      body: 'B',
      priority: 'HIGH',
    });
  };
  return {
    service,
    outbox,
    provider,
    sent,
    user,
    sleeps,
    tick: (ms = 0) => {
      clock += ms;
      return service.tick();
    },
  };
}

describe('EmailDeliveryService', () => {
  it('queues and sends only for opted-in users with an address; opted-out get none', async () => {
    const t = setup();
    t.user('in', true);
    t.user('out', false);
    t.user('noaddr', true, null);
    for (const u of ['in', 'out', 'noaddr']) await t.service.enqueue(`n-${u}`, u);
    expect(t.outbox.jobs.size).toBe(2); // opted-out never queued
    await t.tick();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({
      to: 'in@example.com',
      subject: '[HomeSpace] [Quan trọng] T <x>',
      idempotencyKey: 'bc1:in',
    });
    expect(t.sent[0].html).toContain('T &lt;x&gt;');
    expect(t.outbox.jobs.get('n-noaddr')!.status).toBe('skipped');
  });

  it('is idempotent on redelivery: one job, one email', async () => {
    const t = setup();
    t.user('in', true);
    await t.service.enqueue('n-in', 'in');
    await t.service.enqueue('n-in', 'in');
    await t.tick();
    await t.tick();
    await t.tick();
    expect(t.sent).toHaveLength(1);
  });

  it('skips when the user opted out after queueing', async () => {
    const t = setup();
    t.user('in', true);
    await t.service.enqueue('n-in', 'in');
    t.outbox.opted.delete('in');
    await t.tick();
    expect(t.sent).toHaveLength(0);
    expect(t.outbox.jobs.get('n-in')!.errorCode).toBe('opted-out');
  });

  it('does nothing when the key is blank (email disabled)', async () => {
    const t = setup({ enabled: false });
    t.user('in', true);
    await t.service.enqueue('n-in', 'in');
    await t.tick();
    expect(t.outbox.jobs.size).toBe(0);
    expect(t.provider.sendEmail).not.toHaveBeenCalled();
  });

  it('throttles to 2 requests per second', async () => {
    const t = setup();
    for (const u of ['a', 'b', 'c']) {
      t.user(u, true);
      await t.service.enqueue(`n-${u}`, u);
    }
    await t.tick();
    expect(t.sent).toHaveLength(3);
    expect(EMAIL_SEND_INTERVAL_MS).toBe(500);
    // The first send needs no wait; the next two wait one interval each.
    expect(t.sleeps).toEqual([500, 500]);
  });

  it('retries retryable errors with bounded backoff and never retries 4xx', async () => {
    const t = setup();
    t.user('r', true);
    t.user('f', true);
    t.provider.sendEmail.mockImplementation(async (i: SendEmailInput) => {
      const retryable = i.to.startsWith('r');
      throw new EmailSendError('x', retryable, retryable ? 429 : 422);
    });
    await t.service.enqueue('n-r', 'r');
    await t.service.enqueue('n-f', 'f');
    await t.tick();
    expect(t.outbox.jobs.get('n-f')).toMatchObject({
      status: 'failed',
      errorCode: 'http-422',
      attempts: 1,
    });
    expect(t.outbox.jobs.get('n-r')).toMatchObject({
      status: 'pending',
      errorCode: 'http-429',
    });
    await t.tick(); // backoff not elapsed
    expect(t.outbox.jobs.get('n-r')!.attempts).toBe(1);
    for (let i = 0; i < 6; i++) await t.tick(4_000_000);
    expect(t.outbox.jobs.get('n-r')).toMatchObject({
      status: 'failed',
      attempts: EMAIL_MAX_ATTEMPTS,
    });
  });

  it('keeps jobs pending when the directory is down', async () => {
    const t = setup();
    t.user('in', true);
    (t.service as unknown as { directory: UserEmailDirectory }).directory = {
      resolve: async () => {
        throw new Error('down');
      },
    };
    await t.service.enqueue('n-in', 'in');
    await t.tick();
    expect(t.outbox.jobs.get('n-in')).toMatchObject({
      status: 'pending',
      errorCode: 'directory-unavailable',
    });
  });
});

describe('CoreUserEmailDirectory', () => {
  it('posts ids with the internal secret and maps the result', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ result: [{ userId: 'u1', email: 'u1@example.com' }] }),
        ),
      );
    globalThis.fetch = fetchMock;
    const secret = 's'.repeat(32);
    const dir = new CoreUserEmailDirectory(
      new ConfigService({
        CORE_INTERNAL_BASE_URL: 'http://core:8080',
        GATEWAY_INTERNAL_SECRET: secret,
      }),
    );
    expect((await dir.resolve(['u1', 'u2'])).get('u1')).toBe('u1@example.com');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://core:8080/internal/users/emails');
    expect(init.headers).toMatchObject({ 'X-Internal-Secret': secret });
    expect(JSON.parse(init.body as string)).toEqual({ userIds: ['u1', 'u2'] });
  });
});
