import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, PipelineStage } from 'mongoose';
import { DELIVERY_MODEL, Delivery } from './delivery.schema';
import { EMAIL_DELIVERY_MODEL, EmailDelivery } from './email-outbox';
import { EmailProvider } from './email.provider';
import { FirebasePushProvider } from './firebase-push.provider';

const KNOWN_ERRORS = ['no-spec', 'no-address', 'opted-out', 'attachment-not-ready', 'document-unavailable',
  'send-failed', 'lease-expired', 'directory-unavailable', 'provider-unavailable', 'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token', 'messaging/server-unavailable', 'messaging/internal-error',
  'messaging/quota-exceeded', 'messaging/mismatched-credential', 'messaging/invalid-argument'];
type Totals = { pending: number; processing: number; failed24h: number; skipped24h: number;
  accepted24h: number; sent24h: number; retryDue: number; oldestPending: Date | null };
type Aggregate = { totals: Totals[]; errors: { _id: string; count: number }[] };

/** Fixed-size Mongo aggregates only: never load delivery payloads or recipient/device identifiers. */
@Injectable()
export class DeliveryHealthService {
  private cached?: { expires: number; value: DeliveryHealthResponse };
  private loading?: Promise<DeliveryHealthResponse>;

  constructor(
    @InjectModel(EMAIL_DELIVERY_MODEL) private readonly emailJobs: Model<EmailDelivery>,
    @InjectModel(DELIVERY_MODEL) private readonly pushJobs: Model<Delivery>,
    private readonly email: EmailProvider,
    private readonly push: FirebasePushProvider,
    private readonly config: ConfigService,
  ) {}

  async summary(): Promise<DeliveryHealthResponse> {
    if (this.cached && this.cached.expires > Date.now()) return this.cached.value;
    if (this.loading) return this.loading;
    this.loading = this.load(new Date());
    try {
      const value = await this.loading;
      this.cached = { expires: Date.now() + 15_000, value };
      return value;
    } finally { this.loading = undefined; }
  }

  private async load(now: Date) {
    const [email, push] = await Promise.all([
      this.channel(this.emailJobs, now), this.channel(this.pushJobs, now),
    ]);
    return {
      asOf: now.toISOString(), windowStart: new Date(now.getTime() - 86400_000).toISOString(),
      email: { enabled: this.email.enabled, ...email },
      push: { enabled: this.push.enabled, ...push, devicesDeactivated24h: null,
        devicesSource: 'UNAVAILABLE_NO_DEACTIVATION_HISTORY' },
      kafka: { enabled: this.config.get<boolean>('KAFKA_ENABLED') === true, lag: null,
        dlt: { notification: null, news: null }, source: 'UNAVAILABLE_NO_LOCAL_KAFKA_METRICS' },
      loops: { email: null, push: null, eureka: null, source: 'UNAVAILABLE_NO_LOOP_HEARTBEATS' },
      notes: ['24h counts describe current job states last updated in [windowStart, asOf); not transition history.',
        'accepted means provider accepted, not displayed or read.', 'Empty pending queue has null oldestPendingAgeSec.',
        'Enabled flags describe configuration, not provider readiness.'],
    };
  }

  private async channel(model: Model<EmailDelivery> | Model<Delivery>, now: Date) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const rows = await Promise.race([
        model.aggregate<Aggregate>(deliveryHealthPipeline(now))
          .option({ maxTimeMS: 2500, timeoutMS: 3000, signal: controller.signal }).exec(),
        new Promise<Aggregate[]>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Delivery health source timeout')); }, 3000);
        }),
      ]);
      const totals = rows[0]?.totals[0];
      return {
        source: 'AVAILABLE_MONGO_CURRENT_STATE', pending: totals?.pending ?? 0, processing: totals?.processing ?? 0,
        failed24h: totals?.failed24h ?? 0, skipped24h: totals?.skipped24h ?? 0,
        accepted24h: totals?.accepted24h ?? 0, sent24h: totals?.sent24h ?? 0, retryDue: totals?.retryDue ?? 0,
        oldestPendingAgeSec: totals?.oldestPending ? Math.max(0, Math.floor((now.getTime() - new Date(totals.oldestPending).getTime()) / 1000)) : null,
        byErrorCode24h: Object.fromEntries((rows[0]?.errors ?? []).map(row => [row._id, row.count])),
      };
    } catch {
      return { source: 'UNAVAILABLE_MONGO_AGGREGATION', pending: null, processing: null, failed24h: null,
        skipped24h: null, accepted24h: null, sent24h: null, retryDue: null,
        oldestPendingAgeSec: null, byErrorCode24h: null };
    } finally { clearTimeout(timer); }
  }
}

export type DeliveryHealthResponse = Awaited<ReturnType<DeliveryHealthService['load']>>;

export function deliveryHealthPipeline(now: Date): PipelineStage[] {
  const start = new Date(now.getTime() - 86400_000);
  const recent = { $and: [{ $gte: ['$updatedAt', start] }, { $lt: ['$updatedAt', now] }] };
  const is = (status: string) => ({ $eq: ['$status', status] });
  const count = (condition: object) => ({ $sum: { $cond: [condition, 1, 0] } });
  return [
    { $project: { status: 1, updatedAt: 1, createdAt: 1, nextAttemptAt: 1,
      safeError: { $switch: { branches: [
        { case: { $in: ['$errorCode', KNOWN_ERRORS] }, then: '$errorCode' },
        { case: { $regexMatch: { input: { $ifNull: ['$errorCode', ''] }, regex: '^http-5[0-9]{2}$' } }, then: 'http-5xx' },
        { case: { $regexMatch: { input: { $ifNull: ['$errorCode', ''] }, regex: '^http-4[0-9]{2}$' } }, then: 'http-4xx' },
      ], default: { $cond: [{ $ifNull: ['$errorCode', false] }, 'OTHER', null] } } } } },
    { $facet: {
      totals: [{ $group: { _id: null, pending: count(is('pending')), processing: count(is('processing')),
        failed24h: count({ $and: [is('failed'), recent] }), skipped24h: count({ $and: [is('skipped'), recent] }),
        accepted24h: count({ $and: [is('accepted'), recent] }), sent24h: count({ $and: [is('sent'), recent] }),
        retryDue: count({ $and: [is('pending'), { $lte: ['$nextAttemptAt', now] }] }),
        oldestPending: { $min: { $cond: [is('pending'), '$createdAt', null] } },
      } }],
      errors: [{ $match: { updatedAt: { $gte: start, $lt: now }, safeError: { $ne: null } } },
        { $group: { _id: '$safeError', count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
    } },
  ];
}
