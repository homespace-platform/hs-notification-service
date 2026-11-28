import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import request from 'supertest';
import { DeliveryHealthController, SystemHealthViewGuard } from './delivery-health.controller';
import { DeliveryHealthService, deliveryHealthPipeline } from './delivery-health.service';
import { EmailDelivery } from './email-outbox';
import { Delivery } from './delivery.schema';
import { EmailProvider } from './email.provider';
import { FirebasePushProvider } from './firebase-push.provider';
import { GatewayAuthenticationGuard } from '../authentication/presentation/guards/gateway-authentication.guard';
import { AdminGuard } from '../authentication/presentation/guards/admin.guard';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';

const SECRET = 'p6-only-test-secret';
const NOW = new Date('2026-11-28T00:00:00.000Z');
const config = { get: () => false, getOrThrow: () => SECRET } as unknown as ConfigService;

function model(result: unknown, error = false) {
  const exec = jest.fn<() => Promise<unknown>>();
  if (error) exec.mockRejectedValue(new Error('mongodb://private:secret@host'));
  else exec.mockResolvedValue(result);
  const option = jest.fn().mockReturnValue({ exec });
  return { aggregate: jest.fn().mockReturnValue({ option }), option, exec };
}
function service(email: ReturnType<typeof model>, push: ReturnType<typeof model>) {
  return new DeliveryHealthService(email as unknown as Model<EmailDelivery>, push as unknown as Model<Delivery>,
    { enabled: true } as EmailProvider, { enabled: false } as FirebasePushProvider, config);
}

describe('delivery health aggregates', () => {
  afterEach(() => jest.useRealTimers());
  it('returns only fixed aggregate fields and shares a bounded cache including concurrent reads', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const email = model([{ totals: [{ pending: 3, processing: 1, failed24h: 2, skipped24h: 4,
      accepted24h: 0, sent24h: 5, retryDue: 2, oldestPending: new Date(NOW.getTime()-20_000) }],
      errors: [{ _id: 'http-5xx', count: 2 }], recipientId: 'never-return', payload: 'never-return' }]);
    const push = model([]);
    const health = service(email, push);
    const [a, b] = await Promise.all([health.summary(), health.summary()]);
    expect(a).toBe(b); expect(a.email.pending).toBe(3); expect(a.email.oldestPendingAgeSec).toBe(20);
    expect(a.email.byErrorCode24h).toEqual({ 'http-5xx': 2 });
    expect(a.push.enabled).toBe(false); expect(a.push.pending).toBe(0); expect(a.push.oldestPendingAgeSec).toBeNull();
    expect(a.kafka.lag).toBeNull(); expect(a.kafka.dlt.notification).toBeNull(); expect(a.loops.email).toBeNull();
    expect(a.push.devicesDeactivated24h).toBeNull();
    expect(JSON.stringify(a)).not.toMatch(/never-return|recipientId|providerMessageId|privateKey|token/);
    await health.summary(); expect(email.aggregate).toHaveBeenCalledTimes(1);
    expect(email.option).toHaveBeenCalledWith({ maxTimeMS: 2500, timeoutMS: 3000, signal: expect.any(AbortSignal) });
    jest.advanceTimersByTime(15000); await health.summary(); expect(email.aggregate).toHaveBeenCalledTimes(2);
  });
  it('uses half-open 24h bounds and projects out sensitive fields before grouping errors into a fixed vocabulary', () => {
    const pipeline = deliveryHealthPipeline(NOW);
    const projection = (pipeline[0] as any).$project;
    expect(Object.keys(projection).sort()).toEqual(['createdAt','nextAttemptAt','safeError','status','updatedAt']);
    const facet = (pipeline[1] as any).$facet;
    expect(facet.errors[0].$match.updatedAt).toEqual({ $gte: new Date('2026-11-27T00:00:00.000Z'), $lt: NOW });
    expect(facet.totals[0].$group.retryDue.$sum.$cond[0].$and).toEqual([
      { $eq: ['$status','pending'] }, { $lte: ['$nextAttemptAt',NOW] },
    ]);
    const branches = projection.safeError.$switch.branches;
    expect(branches[0].case.$in[1]).toContain('opted-out');
    expect(branches[1].then).toBe('http-5xx');
    expect(projection.safeError.$switch.default.$cond[1]).toBe('OTHER');
    expect(facet.totals[0].$group.oldestPending.$min.$cond[0]).toEqual({ $eq: ['$status','pending'] });
  });
  it('reports a failed source as unavailable rather than healthy zero without losing the other source', async () => {
    const a = await service(model([], true), model([])).summary();
    expect(a.email.source).toBe('UNAVAILABLE_MONGO_AGGREGATION'); expect(a.email.pending).toBeNull();
    expect(a.email.byErrorCode24h).toBeNull(); expect(a.push.pending).toBe(0);
    expect(JSON.stringify(a)).not.toContain('secret');
  });
  it('bounds a stalled source to three seconds and aborts it without blocking the other source', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const email = model([]); email.exec.mockImplementation(() => new Promise(() => {}));
    const pending = service(email, model([])).summary();
    await jest.advanceTimersByTimeAsync(3000);
    const result = await pending;
    expect(result.email.pending).toBeNull(); expect(result.push.pending).toBe(0);
    const options = email.option.mock.calls[0][0] as { signal: AbortSignal };
    expect(options.signal.aborted).toBe(true);
  });
});

describe('delivery-health HTTP authorization', () => {
  let app: INestApplication;
  const summary = jest.fn<() => Promise<object>>().mockResolvedValue({ email: { pending: 0 } });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [DeliveryHealthController], providers: [
      GatewayAuthenticationGuard, AdminGuard, SystemHealthViewGuard,
      { provide: ConfigService, useValue: config }, { provide: DeliveryHealthService, useValue: { summary } },
    ] }).compile();
    app = module.createNestApplication(); app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => summary.mockClear());
  it.each([
    [{},401],
    [{ 'X-User-Id':'forged','X-User-Role':'ADMIN','X-User-Authorities':'SYSTEM_HEALTH_VIEW' },401],
    [{ 'X-Internal-Secret':'wrong','X-User-Id':'forged','X-User-Role':'ADMIN','X-User-Authorities':'SYSTEM_HEALTH_VIEW' },401],
    [{ 'X-Internal-Secret':SECRET,'X-User-Id':'user','X-User-Role':'USER','X-User-Authorities':'ADMIN,SYSTEM_HEALTH_VIEW' },403],
    [{ 'X-Internal-Secret':SECRET,'X-User-Id':'admin','X-User-Role':'ADMIN','X-User-Authorities':'BLOCKCHAIN_VIEW' },403],
    [{ 'X-Internal-Secret':SECRET,'X-User-Id':'admin','X-User-Role':'ADMIN' },403],
  ])('rejects unauthorized context %#', async (headers, status) => {
    const response = await request(app.getHttpServer()).get('/admin/delivery-health').set(headers).expect(status);
    expect(response.body.result).toBeUndefined(); expect(summary).not.toHaveBeenCalled();
  });
  it('accepts verified ADMIN with only the required authority and keeps the standard private envelope', async () => {
    await request(app.getHttpServer()).get('/admin/delivery-health').set({ 'X-Internal-Secret':SECRET,
      'X-User-Id':'admin','X-User-Role':'ADMIN','X-User-Authorities':' SYSTEM_HEALTH_VIEW ' })
      .expect(200).expect('Cache-Control','private, no-store').expect({ code:1000,result:{email:{pending:0}} });
    expect(summary).toHaveBeenCalledTimes(1);
  });
});
