import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Schema } from 'mongoose';
import { NotificationDocument } from '../notification/infrastructure/notification.schema';
import { NotificationPreferenceDocument } from '../notification/infrastructure/notification-preference.schema';

export const EMAIL_MAX_ATTEMPTS = 5;
export const EMAIL_DELIVERY_MODEL = 'NotificationEmailDelivery';

export interface EmailJob {
  notificationId: string;
  recipientId: string;
  attempts: number;
}
export interface EmailJobPatch {
  status: 'pending' | 'sent' | 'skipped' | 'failed';
  nextAttemptAt?: Date;
  providerMessageId?: string;
  errorCode?: string;
}
export interface EmailContent {
  sourceEventId: string;
  title: string;
  body: string;
  priority: string;
}

/** Port so the dispatcher is testable without MongoDB. */
export abstract class EmailOutbox {
  /** Idempotent per notification. */
  abstract add(notificationId: string, recipientId: string): Promise<void>;
  abstract claim(limit: number, now: Date, leaseUntil: Date): Promise<EmailJob[]>;
  abstract finish(job: EmailJob, patch: EmailJobPatch): Promise<void>;
  abstract content(job: EmailJob): Promise<EmailContent | null>;
  /** Email for SYSTEM is opt-in: only an explicit true counts. */
  abstract optedIn(userId: string): Promise<boolean>;
}

export interface EmailDelivery {
  notificationId: string;
  recipientId: string;
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
    @InjectModel(NotificationDocument.name)
    private readonly notifications: Model<NotificationDocument>,
    @InjectModel(NotificationPreferenceDocument.name)
    private readonly preferences: Model<NotificationPreferenceDocument>,
  ) {
    super();
  }

  async add(notificationId: string, recipientId: string): Promise<void> {
    try {
      await this.jobs
        .updateOne(
          { notificationId },
          {
            $setOnInsert: {
              notificationId,
              recipientId,
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
        attempts: job.attempts,
      });
    }
    return claimed;
  }

  async finish(job: EmailJob, patch: EmailJobPatch): Promise<void> {
    await this.jobs
      .updateOne(
        { notificationId: job.notificationId, status: 'processing' },
        { $set: patch, $unset: { leaseUntil: 1 } },
      )
      .exec();
  }

  async content(job: EmailJob): Promise<EmailContent | null> {
    const row = await this.notifications
      .findOne({
        _id: job.notificationId,
        recipientId: job.recipientId,
        deletedAt: null,
      })
      .lean()
      .exec();
    return row
      ? {
          sourceEventId: row.sourceEventId,
          title: row.title,
          body: row.body,
          priority: row.priority,
        }
      : null;
  }

  async optedIn(userId: string): Promise<boolean> {
    const doc = await this.preferences.findOne({ userId }).lean().exec();
    return (
      doc?.items.some((i) => i.category === 'SYSTEM' && i.email === true) ??
      false
    );
  }
}
