import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { EmailProvider, EmailSendError, maskEmail } from './email.provider';

const KEY = 're_secret_key_123';
const cfg = (over: Record<string, string> = {}) =>
  new ConfigService({ MAIL_RESEND_API_KEY: KEY, MAIL_FROM_ADDRESS: 'no-reply@homespace.vn', MAIL_FROM_NAME: 'HomeSpace', ...over });
const input = { to: 'alice@example.com', subject: 'Hi', html: '<p>secret body</p>' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('EmailProvider', () => {
  let fetchMock: jest.Mock<typeof fetch>;
  let logs: string[];
  beforeEach(() => {
    fetchMock = jest.fn<typeof fetch>().mockResolvedValue(reply(200, { id: 'em_1' }));
    globalThis.fetch = fetchMock;
    logs = [];
    // Nest's default logger writes through process.stdout/stderr.
    for (const stream of [process.stdout, process.stderr])
      jest.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => { logs.push(String(chunk)); return true; }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('builds the Resend request and returns the id', async () => {
    await expect(new EmailProvider(cfg()).sendEmail({ ...input, idempotencyKey: 'k1', tags: [{ name: 'a', value: 'b' }] })).resolves.toBe('em_1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, 'Idempotency-Key': 'k1' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: 'HomeSpace <no-reply@homespace.vn>', to: ['alice@example.com'], subject: 'Hi', tags: [{ name: 'a', value: 'b' }],
    });
  });

  it('sends attachments as Resend filename + base64 content, and omits the field when there are none', async () => {
    fetchMock.mockImplementation(async () => reply(200, { id: 'em_1' }));
    await new EmailProvider(cfg()).sendEmail({ ...input, attachments: [{ filename: 'a.pdf', content: 'UERG' }] });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).attachments).toEqual([{ filename: 'a.pdf', content: 'UERG' }]);
    await new EmailProvider(cfg()).sendEmail({ ...input, attachments: [] });
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).not.toHaveProperty('attachments');
  });

  it('omits Idempotency-Key when not given', async () => {
    await new EmailProvider(cfg()).sendEmail(input);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Idempotency-Key');
  });

  it.each([400, 401, 403, 422])('%s is non-retryable with the Resend message', async (status) => {
    fetchMock.mockResolvedValue(reply(status, { message: 'domain not verified' }));
    await expect(new EmailProvider(cfg()).sendEmail(input)).rejects.toMatchObject({ retryable: false, message: 'domain not verified', status });
  });

  it.each([429, 500, 503])('%s is retryable', async (status) => {
    fetchMock.mockResolvedValue(reply(status, { message: 'x' }));
    await expect(new EmailProvider(cfg()).sendEmail(input)).rejects.toMatchObject({ retryable: true });
  });

  it('network failure and timeout are retryable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(new EmailProvider(cfg()).sendEmail(input)).rejects.toMatchObject({ retryable: true });
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    await expect(new EmailProvider(cfg()).sendEmail(input)).rejects.toMatchObject({ retryable: true, message: 'Resend request timed out' });
  });

  it('never logs the key, full address or body', async () => {
    await new EmailProvider(cfg()).sendEmail(input);
    fetchMock.mockResolvedValue(reply(422, { message: 'bad' }));
    await new EmailProvider(cfg()).sendEmail(input).catch(() => undefined);
    const all = logs.join('\n');
    expect(all).toContain('a***@example.com');
    for (const s of [KEY, 'alice@example.com', 'secret body']) expect(all).not.toContain(s);
  });

  it('is disabled when the key is blank and does not call Resend', async () => {
    const p = new EmailProvider(cfg({ MAIL_RESEND_API_KEY: '  ' }));
    expect(p.enabled).toBe(false);
    p.onModuleInit();
    expect(logs.join()).toContain('disabled');
    await expect(p.sendEmail(input)).rejects.toBeInstanceOf(EmailSendError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { to: 'not-an-email' }, { to: 'a@b.co, c@d.co' }, { to: '' }, { subject: '  ' }, { html: '', text: '' },
  ])('rejects invalid input %j without calling Resend', async (bad) => {
    await expect(new EmailProvider(cfg()).sendEmail({ ...input, ...bad })).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts text-only mail and masks addresses', async () => {
    await expect(new EmailProvider(cfg()).sendEmail({ to: input.to, subject: 's', text: 't' })).resolves.toBe('em_1');
    expect(maskEmail('bob@x.vn')).toBe('b***@x.vn');
  });
});
