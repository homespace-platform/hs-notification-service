import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Schema } from 'mongoose';
import { emailDefault, type NotificationCategory, type NotificationMetadata } from '../notification/domain/notification.model';
import { NotificationPreferenceDocument } from '../notification/infrastructure/notification-preference.schema';

export const EMAIL_MAX_ATTEMPTS = 5;
export const EMAIL_DELIVERY_MODEL = 'NotificationEmailDelivery';

/** Everything the email needs, copied at enqueue time so rendering never depends on later notification state. */
export interface NewEmailJob {
  notificationId: string;
  recipientId: string;
  category: NotificationCategory;
  eventType: string;
  title: string;
  body: string;
  priority: string;
  actionPath: string | null;
  data: NotificationMetadata;
  occurredAt: Date;
}
export interface EmailJob extends NewEmailJob {
  attempts: number;
  createdAt: Date;
}
export interface EmailJobPatch {
  status: 'pending' | 'sent' | 'skipped' | 'failed';
  nextAttemptAt?: Date;
  providerMessageId?: string;
  errorCode?: string;
  /** Waiting for an attachment that is not ready yet must not use up a send attempt. */
  refundAttempt?: boolean;
}

/** Port so the dispatcher is testable without MongoDB. */
export abstract class EmailOutbox {
  /** Idempotent per notification. */
  abstract add(job: NewEmailJob): Promise<void>;
  abstract claim(limit: number, now: Date, leaseUntil: Date): Promise<EmailJob[]>;
  abstract finish(job: EmailJob, patch: EmailJobPatch): Promise<void>;
  /** Category Email toggle; no stored choice falls back to the category default (PAYMENT/CONTRACT on, others off). */
  abstract optedIn(userId: string, category: NotificationCategory): Promise<boolean>;
}

export interface EmailDelivery extends NewEmailJob {
  status: 'pending' | 'processing' | 'sent' | 'skipped' | 'failed';
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil?: Date;
  providerMessageId?: string;
  errorCode?: string;
}
export const EmailDeliverySchema = new Schema<EmailDelivery>(
  {
    notificationId: { type: String, required: true, unique: true },
    recipientId: { type: String, required: true },
    category: String,
    eventType: String,
    title: String,
    body: String,
    priority: String,
    actionPath: { type: String, default: null },
    data: { type: Schema.Types.Mixed, default: {} },
    occurredAt: Date,
    status: {
      type: String,
      required: true,
      enum: ['pending', 'processing', 'sent', 'skipped', 'failed'],
    },
    attempts: { type: Number, required: true },
    nextAttemptAt: { type: Date, required: true },
    leaseUntil: Date,
    providerMessageId: String,
    errorCode: String,
  },
  {
    collection: 'notification_email_deliveries',
    versionKey: false,
    timestamps: true,
  },
);
EmailDeliverySchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });

@Injectable()
export class MongoEmailOutbox extends EmailOutbox {
  constructor(
    @InjectModel(EMAIL_DELIVERY_MODEL)
    private readonly jobs: Model<EmailDelivery>,
    @InjectModel(NotificationPreferenceDocument.name)
    private readonly preferences: Model<NotificationPreferenceDocument>,
  ) {
    super();
  }

  async add(job: NewEmailJob): Promise<void> {
    const { notificationId } = job;
    try {
      await this.jobs
        .updateOne(
          { notificationId },
          {
            $setOnInsert: {
              ...job,
              status: 'pending',
              attempts: 0,
              nextAttemptAt: new Date(),
            },
          },
          { upsert: true },
        )
        .exec();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }

  async claim(limit: number, now: Date, leaseUntil: Date): Promise<EmailJob[]> {
    // A worker that died on its last attempt must not leave an eternal processing job.
    await this.jobs
      .updateMany(
        {
          status: 'processing',
          attempts: { $gte: EMAIL_MAX_ATTEMPTS },
          leaseUntil: { $lte: now },
        },
        { $set: { status: 'failed', errorCode: 'lease-expired' } },
      )
      .exec();
    const claimed: EmailJob[] = [];
    while (claimed.length < limit) {
      const job = await this.jobs
        .findOneAndUpdate(
          {
            attempts: { $lt: EMAIL_MAX_ATTEMPTS },
            $or: [
              { status: 'pending', nextAttemptAt: { $lte: now } },
              { status: 'processing', leaseUntil: { $lte: now } },
            ],
          },
          { $set: { status: 'processing', leaseUntil }, $inc: { attempts: 1 } },
          { returnDocument: 'after', sort: { nextAttemptAt: 1 } },
        )
        .lean()
        .exec();
      if (!job) break;
      claimed.push({
        notificationId: job.notificationId,
        recipientId: job.recipientId,
        category: job.category,
        eventType: job.eventType,
        title: job.title,
        body: job.body,
        priority: job.priority,
        actionPath: job.actionPath ?? null,
        data: job.data ?? {},
        occurredAt: job.occurredAt,
        attempts: job.attempts,
        createdAt: (job as unknown as { createdAt: Date }).createdAt,
      });
    }
    return claimed;
  }

  async finish(job: EmailJob, patch: EmailJobPatch): Promise<void> {
    const { refundAttempt, ...set } = patch;
    await this.jobs
      .updateOne(
        { notificationId: job.notificationId, status: 'processing' },
        {
          $set: set,
          $unset: { leaseUntil: 1 },
          ...(refundAttempt ? { $inc: { attempts: -1 } } : {}),
        },
      )
      .exec();
  }

  async optedIn(userId: string, category: NotificationCategory): Promise<boolean> {
    const doc = await this.preferences.findOne({ userId }).lean().exec();
    return doc?.items.find((i) => i.category === category)?.email ?? emailDefault(category);
  }
}
