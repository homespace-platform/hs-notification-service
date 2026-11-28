import { EurekaDiscoveryService } from '../../infrastructure/discovery/eureka-discovery.service';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { NotificationRecord } from '../notification/domain/notification.model';
import {
  ATTACHMENT_NOTE,
  ATTACHMENT_WAIT_MS,
  EMAIL_SEND_INTERVAL_MS,
  EmailDeliveryService,
  MAX_ATTACHMENT_BYTES,
} from './email-delivery.service';
import { CoreDocumentClient, DocumentClient, type DocumentResult } from './core-document.client';
import { emailSpecFor } from './email/email-registry';
import {
  EMAIL_MAX_ATTEMPTS,
  EmailOutbox,
  type EmailJob,
  type EmailJobPatch,
  type NewEmailJob,
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
  /** `${userId}:${category}` explicit toggle; absent means the category default (PAYMENT/CONTRACT on). */
  toggles = new Map<string, boolean>();
  clock = () => 1_000_000;
  async add(job: NewEmailJob) {
    if (!this.jobs.has(job.notificationId))
      this.jobs.set(job.notificationId, {
        ...job,
        attempts: 0,
        status: 'pending',
        due: 0,
        createdAt: new Date(this.clock()),
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
        out.push({ ...j });
      }
    }
    return out;
  }
  async finish(job: EmailJob, p: EmailJobPatch) {
    const j = this.jobs.get(job.notificationId)!;
    j.status = p.status;
    j.errorCode = p.errorCode;
    j.due = p.nextAttemptAt?.getTime() ?? 0;
    if (p.refundAttempt) j.attempts--;
  }
  async optedIn(userId: string, category: string) {
    return this.toggles.get(`${userId}:${category}`) ?? ['PAYMENT', 'CONTRACT'].includes(category);
  }
}

const BASE = 'https://homespace.id.vn';
const RECEIPT = { receiptId: 'rc1', receiptNumber: 'BN-1' };
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
      new Map(ids.filter((i) => emails.has(i)).map((i) => [i, emails.get(i)!])),
  };
  const documents = {
    fetch: jest.fn<DocumentClient['fetch']>(async () => ({
      outcome: 'ok',
      files: [{ fileName: 'bien-nhan.pdf', contentBase64: 'UERG' }],
    })),
  };
  const service = new EmailDeliveryService(
    outbox,
    provider as unknown as EmailProvider,
    directory,
    documents as unknown as DocumentClient,
    new ConfigService({ MAIL_APP_BASE_URL: BASE }),
  );
  let clock = 1_000_000;
  const sleeps: number[] = [];
  service.now = () => clock;
  outbox.clock = () => clock;
  service.sleep = async (ms) => {
    sleeps.push(ms);
    clock += ms;
  };
  const record = (id: string, over: Partial<NotificationRecord> = {}): NotificationRecord => {
    emails.set(id, `${id}@example.com`);
    return {
      id: `n-${id}`,
      recipientId: id,
      sourceEventId: 'admin_bc1',
      category: 'SYSTEM',
      type: 'PLATFORM_ANNOUNCEMENT',
      title: 'T <x>',
      body: 'B',
      priority: 'HIGH',
      actionPath: '/notifications',
      metadata: null,
      createdAt: new Date(1_000_000),
      readAt: null,
      deletedAt: null,
      ...over,
    };
  };
  /** A SYSTEM broadcast for a user whose SYSTEM toggle is `optIn`; `email: null` means no address. */
  const user = (id: string, optIn = true, email: string | null = `${id}@example.com`) => {
    outbox.toggles.set(`${id}:SYSTEM`, optIn);
    const r = record(id);
    if (!email) emails.delete(id);
    return r;
  };
  const receipt = (id: string, data: Record<string, string | number | boolean> = RECEIPT) =>
    record(id, { category: 'PAYMENT', type: 'PAYMENT_RECEIPT_CONFIRMED', title: 'Thanh toán thành công', metadata: data });
  return {
    service,
    outbox,
    provider,
    documents,
    sent,
    user,
    receipt,
    record,
    sleeps,
    tick: (ms = 0) => {
      clock += ms;
      return service.tick();
    },
  };
}

const jobOf = (t: ReturnType<typeof setup>, id: string) => t.outbox.jobs.get(`n-${id}`)!;

describe('email registry', () => {
  it('finds specs by event type; unknown and never-email types have none', () => {
    expect(emailSpecFor('PLATFORM_ANNOUNCEMENT')?.policy).toBe('OPT_IN');
    expect(emailSpecFor('PAYMENT_RECEIPT_CONFIRMED')).toMatchObject({ policy: 'ALWAYS', attachments: ['RENTAL_RECEIPT'] });
    expect(emailSpecFor('AGREEMENT_FULLY_SIGNED')?.attachments).toEqual(['LEASE_BUNDLE']);
    expect(emailSpecFor('CHAT_MESSAGE_RECEIVED')).toBeUndefined();
    expect(emailSpecFor('INVOICE_AMOUNT_UPDATED')).toBeUndefined();
    expect(emailSpecFor('toString')).toBeUndefined();
  });
});

describe('EmailDeliveryService', () => {
  it('queues and sends only for opted-in users with an address; opted-out get none (SYSTEM broadcast unchanged)', async () => {
    const t = setup();
    const records = [t.user('in'), t.user('out', false), t.user('noaddr', true, null)];
    for (const r of records) await t.service.enqueue(r);
    expect(t.outbox.jobs.size).toBe(2); // opted-out never queued
    await t.tick();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({
      to: 'in@example.com',
      subject: '[HomeSpace] [Quan trọng] T <x>',
      idempotencyKey: 'n-in',
    });
    expect(t.sent[0].attachments).toBeUndefined();
    expect(t.sent[0].html).toContain('T &lt;x&gt;');
    expect(jobOf(t, 'noaddr').status).toBe('skipped');
  });

  it('is idempotent on redelivery: one job, one email', async () => {
    const t = setup();
    const r = t.user('in');
    await t.service.enqueue(r);
    await t.service.enqueue(r);
    await t.tick();
    await t.tick();
    expect(t.sent).toHaveLength(1);
  });

  it('stores the render context on the job', async () => {
    const t = setup();
    await t.service.enqueue(t.user('in'));
    expect(jobOf(t, 'in')).toMatchObject({ eventType: 'PLATFORM_ANNOUNCEMENT', title: 'T <x>', actionPath: '/notifications', priority: 'HIGH' });
  });

  it('skips when the user opted out after queueing', async () => {
    const t = setup();
    await t.service.enqueue(t.user('in'));
    t.outbox.toggles.set('in:SYSTEM', false);
    await t.tick();
    expect(t.sent).toHaveLength(0);
    expect(jobOf(t, 'in').errorCode).toBe('opted-out');
  });

  it('does nothing when the key is blank (email disabled)', async () => {
    const t = setup({ enabled: false });
    await t.service.enqueue(t.user('in'));
    await t.tick();
    expect(t.outbox.jobs.size).toBe(0);
    expect(t.provider.sendEmail).not.toHaveBeenCalled();
  });

  it('throttles to 2 requests per second', async () => {
    const t = setup();
    for (const u of ['a', 'b', 'c']) await t.service.enqueue(t.user(u));
    await t.tick();
    expect(t.sent).toHaveLength(3);
    expect(EMAIL_SEND_INTERVAL_MS).toBe(500);
    expect(t.sleeps).toEqual([500, 500]);
  });

  it('retries retryable errors with bounded backoff and never retries 4xx', async () => {
    const t = setup();
    await t.service.enqueue(t.user('r'));
    await t.service.enqueue(t.user('f'));
    t.provider.sendEmail.mockImplementation(async (i: SendEmailInput) => {
      const retryable = i.to.startsWith('r');
      throw new EmailSendError('x', retryable, retryable ? 429 : 422);
    });
    await t.tick();
    expect(jobOf(t, 'f')).toMatchObject({ status: 'failed', errorCode: 'http-422', attempts: 1 });
    expect(jobOf(t, 'r')).toMatchObject({ status: 'pending', errorCode: 'http-429' });
    await t.tick(); // backoff not elapsed
    expect(jobOf(t, 'r').attempts).toBe(1);
    for (let i = 0; i < 6; i++) await t.tick(4_000_000);
    expect(jobOf(t, 'r')).toMatchObject({ status: 'failed', attempts: EMAIL_MAX_ATTEMPTS });
  });

  it('keeps jobs pending when the directory is down', async () => {
    const t = setup();
    await t.service.enqueue(t.user('in'));
    (t.service as unknown as { directory: UserEmailDirectory }).directory = {
      resolve: async () => {
        throw new Error('down');
      },
    };
    await t.tick();
    expect(jobOf(t, 'in')).toMatchObject({ status: 'pending', errorCode: 'directory-unavailable' });
  });

  describe('policy and defaults', () => {
    it('ALWAYS ignores the toggle; OPT_IN follows it; PAYMENT/CONTRACT default on, SYSTEM off', async () => {
      const t = setup();
      t.outbox.toggles.set('a:PAYMENT', false);
      await t.service.enqueue(t.receipt('a')); // ALWAYS receipt with the toggle off
      expect(t.outbox.jobs.has('n-a')).toBe(true);

      expect(emailSpecFor('PAYMENT_REQUEST_CREATED')?.policy).toBe('OPT_IN');
      const payment = (id: string) => t.record(id, { category: 'PAYMENT', type: 'PAYMENT_REQUEST_CREATED' });
      await t.service.enqueue(payment('p-default'));
      t.outbox.toggles.set('p-off:PAYMENT', false);
      await t.service.enqueue(payment('p-off'));
      await t.service.enqueue(t.record('sys-default')); // SYSTEM: no stored choice means off
      t.outbox.toggles.set('sys-on:SYSTEM', true);
      await t.service.enqueue(t.record('sys-on'));
      expect([...t.outbox.jobs.keys()].sort()).toEqual(['n-a', 'n-p-default', 'n-sys-on']);
    });

    it('never emails legacy events, event types without a spec, INVOICE_AMOUNT_UPDATED or admin-audience complaints', async () => {
      const t = setup();
      await t.service.enqueue(t.receipt('l', { ...RECEIPT, legacy: true }));
      await t.service.enqueue(t.record('x', { category: 'CHAT', type: 'CHAT_MESSAGE_RECEIVED' }));
      await t.service.enqueue(t.record('y', { category: 'PAYMENT', type: 'INVOICE_AMOUNT_UPDATED' }));
      await t.service.enqueue(t.record('z', { category: 'RENTAL_REQUEST', type: 'COMPLAINT_OPENED', metadata: { audience: 'ADMIN' } }));
      expect(t.outbox.jobs.size).toBe(0);
      await t.service.enqueue(t.record('c', { category: 'RENTAL_REQUEST', type: 'COMPLAINT_OPENED', metadata: { audience: 'PARTY' } }));
      expect(jobOf(t, 'c').category).toBe('CONTRACT');
    });

    it('the branch digest follows the SYSTEM toggle (default off)', async () => {
      const t = setup();
      const digest = (id: string) => t.record(id, { type: 'BRANCH_DAILY_DIGEST', category: 'SYSTEM', metadata: {} });
      await t.service.enqueue(digest('d1'));
      expect(t.outbox.jobs.size).toBe(0);
      t.outbox.toggles.set('d2:SYSTEM', true);
      await t.service.enqueue(digest('d2'));
      expect(t.outbox.jobs.size).toBe(1);
    });
  });

  describe('attachments', () => {
    it('attaches the receipt as base64 and asks Core for the right document', async () => {
      const t = setup();
      await t.service.enqueue(t.receipt('a'));
      await t.tick();
      expect(t.documents.fetch).toHaveBeenCalledWith('rental-receipts', 'rc1', 'a');
      expect(t.sent[0].attachments).toEqual([{ filename: 'bien-nhan.pdf', content: 'UERG' }]);
      expect(t.sent[0].text).not.toContain(ATTACHMENT_NOTE);
    });

    it.each([
      ['MEMBERSHIP_ACTIVATED', 'PAYMENT', { orderId: 'o1' }, 'membership-receipts', 'o1'],
      ['MEMBERSHIP_OVERPAYMENT_RECEIVED', 'PAYMENT', { orderId: 'o1', overpaymentId: 'op1' }, 'overpayment-receipts', 'op1'],
      ['AGREEMENT_FULLY_SIGNED', 'CONTRACT', { agreementId: 'ag1', agreementKind: 'LEASE', contractId: 'c1' }, 'lease-bundles', 'c1'],
    ] as const)('%s maps to its Core document kind', async (type, category, data, path, id) => {
      const t = setup();
      await t.service.enqueue(t.record('u', { category, type, metadata: data }));
      await t.tick();
      expect(t.documents.fetch).toHaveBeenCalledWith(path, id, 'u');
      expect(t.sent[0].attachments).toHaveLength(1);
    });

    it('does not ask for a lease bundle when the agreement is a deposit', async () => {
      const t = setup();
      await t.service.enqueue(t.record('u', { category: 'CONTRACT', type: 'AGREEMENT_FULLY_SIGNED', metadata: { agreementId: 'ag1', agreementKind: 'DEPOSIT', contractId: 'c1' } }));
      await t.tick();
      expect(t.documents.fetch).not.toHaveBeenCalled();
      expect(t.sent[0].attachments).toBeUndefined();
      expect(t.sent[0].text).not.toContain(ATTACHMENT_NOTE);
    });

    it('waits on 409 with backoff without using attempts, then sends without the file after 30 minutes', async () => {
      const t = setup();
      t.documents.fetch.mockResolvedValue({ outcome: 'not-ready' } as DocumentResult);
      await t.service.enqueue(t.receipt('a'));
      await t.tick();
      expect(t.sent).toHaveLength(0);
      expect(jobOf(t, 'a')).toMatchObject({ status: 'pending', errorCode: 'attachment-not-ready', attempts: 0 });
      for (let i = 0; i < 40 && t.sent.length === 0; i++) await t.tick(300_000);
      expect(t.sent).toHaveLength(1);
      expect(t.sent[0].attachments).toBeUndefined();
      expect(t.sent[0].text).toContain(ATTACHMENT_NOTE);
      expect(t.sent[0].html).toContain(ATTACHMENT_NOTE);
      expect(t.documents.fetch.mock.calls.length).toBeGreaterThan(3);
      expect(ATTACHMENT_WAIT_MS).toBe(30 * 60_000);
    });

    it('sends the file once Core stops answering 409', async () => {
      const t = setup();
      t.documents.fetch.mockResolvedValueOnce({ outcome: 'not-ready' } as DocumentResult);
      await t.service.enqueue(t.receipt('a'));
      await t.tick();
      await t.tick(60_000);
      expect(t.sent[0].attachments).toHaveLength(1);
    });

    it.each([404, 403, 413, 422])('%s sends immediately without the file and adds the note', async (status) => {
      const t = setup();
      t.documents.fetch.mockResolvedValue({ outcome: 'unavailable', status } as DocumentResult);
      await t.service.enqueue(t.receipt('a'));
      await t.tick();
      expect(t.sent).toHaveLength(1);
      expect(t.sent[0].attachments).toBeUndefined();
      expect(t.sent[0].text).toContain(ATTACHMENT_NOTE);
    });

    it('sends without the file and with the note when the event carries no document id', async () => {
      const t = setup();
      await t.service.enqueue(t.receipt('a', {}));
      await t.tick();
      expect(t.documents.fetch).not.toHaveBeenCalled();
      expect(t.sent[0].attachments).toBeUndefined();
      expect(t.sent[0].text).toContain(ATTACHMENT_NOTE);
    });

    it('drops oversized attachments and adds the note', async () => {
      const t = setup();
      t.documents.fetch.mockResolvedValue({ outcome: 'ok', files: [{ fileName: 'big.pdf', contentBase64: 'A'.repeat(MAX_ATTACHMENT_BYTES + 1) }] });
      await t.service.enqueue(t.receipt('a'));
      await t.tick();
      expect(t.sent[0].attachments).toBeUndefined();
      expect(t.sent[0].text).toContain(ATTACHMENT_NOTE);
    });

    it('retries when Core is down, and on the last attempt sends without the file instead of losing the email', async () => {
      const t = setup();
      t.documents.fetch.mockRejectedValue(new Error('down'));
      await t.service.enqueue(t.receipt('a'));
      await t.tick();
      expect(jobOf(t, 'a')).toMatchObject({ status: 'pending', errorCode: 'document-unavailable' });
      for (let i = 0; i < 6; i++) await t.tick(4_000_000);
      expect(t.sent).toHaveLength(1);
      expect(t.sent[0].attachments).toBeUndefined();
      expect(t.sent[0].text).toContain(ATTACHMENT_NOTE);
    });
  });
});

describe('CoreDocumentClient', () => {
  const secret = 's'.repeat(32);
  const client = (forget = jest.fn()) =>
    new CoreDocumentClient(new ConfigService({ GATEWAY_INTERNAL_SECRET: secret }), {
      resolve: async () => 'http://10.0.0.5:8081',
      forget,
    } as unknown as EurekaDiscoveryService);
  const respond = (status: number, body: unknown = {}) =>
    (globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status })));

  it('calls the internal document API with the secret and recipientId and maps files', async () => {
    const fetchMock = respond(200, { files: [{ fileName: 'a.pdf', contentType: 'application/pdf', contentBase64: 'UERG', sizeBytes: 3 }] });
    await expect(client().fetch('rental-receipts', 'rc 1', 'u1')).resolves.toEqual({ outcome: 'ok', files: [{ fileName: 'a.pdf', contentBase64: 'UERG' }] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://10.0.0.5:8081/internal/documents/rental-receipts/rc%201?recipientId=u1');
    expect(init.headers).toMatchObject({ 'X-Internal-Secret': secret });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [409, { outcome: 'not-ready' }],
    [404, { outcome: 'unavailable', status: 404 }],
    [403, { outcome: 'unavailable', status: 403 }],
    [413, { outcome: 'unavailable', status: 413 }],
    [422, { outcome: 'unavailable', status: 422 }],
  ])('maps %s', async (status, expected) => {
    respond(status);
    await expect(client().fetch('rental-receipts', 'x', 'u')).resolves.toEqual(expected);
  });

  it('treats an unusable 200 as unavailable and 5xx or network errors as retryable', async () => {
    respond(200, { files: [] });
    await expect(client().fetch('rental-receipts', 'x', 'u')).resolves.toMatchObject({ outcome: 'unavailable' });
    const forget = jest.fn();
    respond(503);
    await expect(client(forget).fetch('rental-receipts', 'x', 'u')).rejects.toMatchObject({ name: 'DocumentFetchError' });
    expect(forget).toHaveBeenCalledWith('HS-CORE-API');
    globalThis.fetch = jest.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(client().fetch('rental-receipts', 'x', 'u')).rejects.toMatchObject({ name: 'DocumentFetchError' });
  });
});

describe('CoreUserEmailDirectory', () => {
  const secret = 's'.repeat(32);
  const directory = (resolve: () => Promise<string>, forget = jest.fn()) =>
    new CoreUserEmailDirectory(
      new ConfigService({ GATEWAY_INTERNAL_SECRET: secret }),
      { resolve, forget } as unknown as EurekaDiscoveryService,
    );

  it('finds core through Eureka, posts ids with the internal secret and maps the result', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ result: [{ userId: 'u1', email: 'u1@example.com' }] }),
        ),
      );
    globalThis.fetch = fetchMock;
    const resolve = jest.fn(async () => 'http://10.0.0.5:8081');
    const dir = directory(resolve);
    expect((await dir.resolve(['u1', 'u2'])).get('u1')).toBe('u1@example.com');
    expect(resolve).toHaveBeenCalledWith('HS-CORE-API');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://10.0.0.5:8081/internal/users/emails');
    expect(init.headers).toMatchObject({ 'X-Internal-Secret': secret });
    expect(JSON.parse(init.body as string)).toEqual({ userIds: ['u1', 'u2'] });
  });

  it('forgets the cached core instance after a 5xx so the next try looks it up again', async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const forget = jest.fn();
    await expect(directory(async () => 'http://core:8081', forget).resolve(['u1'])).rejects.toThrow('HTTP 503');
    expect(forget).toHaveBeenCalledWith('HS-CORE-API');
  });
});
