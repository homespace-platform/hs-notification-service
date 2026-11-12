import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import type { NotificationView } from '../notification/application/notification.service';
import { NotificationDocument } from '../notification/infrastructure/notification.schema';
import { NotificationPreferenceDocument } from '../notification/infrastructure/notification-preference.schema';
import {
  DEVICE_MODEL,
  DELIVERY_MODEL,
  Device,
  Delivery,
} from './delivery.schema';
import { FirebasePushProvider } from './firebase-push.provider';

const MAX_ATTEMPTS = 5;
export function retryDelay(attempt: number): number {
  return Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);
}
export function invalidRegistration(code: string): boolean {
  return [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/registration-not-registered',
    'messaging/invalid-recipient',
  ].includes(code);
}

@Injectable()
export class NotificationDeliveryService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopping = false;
  private activeTick?: Promise<void>;
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    @InjectModel(DEVICE_MODEL) private readonly devices: Model<Device>,
    @InjectModel(DELIVERY_MODEL) private readonly deliveries: Model<Delivery>,
    @InjectModel(NotificationDocument.name)
    private readonly notifications: Model<NotificationDocument>,
    @InjectModel(NotificationPreferenceDocument.name)
    private readonly preferences: Model<NotificationPreferenceDocument>,
    private readonly push: FirebasePushProvider,
  ) {}

  async register(
    userId: string,
    input: { installationId: string; installationSecret: string; fid: string },
  ): Promise<void> {
    const secretHash = this.hash(input.installationSecret);
    const existing = await this.devices
      .findOne({ installationId: input.installationId })
      .lean()
      .exec();
    if (existing && existing.secretHash !== secretHash)
      throw new ConflictException('Installation proof does not match');
    const sameBinding =
      existing?.userId === userId &&
      existing.fid === input.fid &&
      existing.active;
    const now = new Date();
    try {
      await this.devices
        .updateOne(
          { installationId: input.installationId, secretHash },
          {
            $set: {
              userId,
              fid: input.fid,
              active: true,
              updatedAt: now,
              generation: sameBinding ? existing.generation : randomUUID(),
              registeredAt: sameBinding ? existing.registeredAt : now,
            },
            $setOnInsert: { installationId: input.installationId, secretHash },
          },
          { upsert: true },
        )
        .exec();
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new ConflictException('Installation is already registered');
      throw error;
    }
  }

  async unregister(
    userId: string,
    installationId: string,
    secret: string,
  ): Promise<void> {
    await this.devices
      .updateOne(
        { userId, installationId, secretHash: this.hash(secret) },
        {
          $set: {
            active: false,
            generation: randomUUID(),
            updatedAt: new Date(),
          },
        },
      )
      .exec();
  }

  /** The notification itself is the durable outbox until every device job exists. */
  async enqueue(
    notification: Pick<NotificationView, 'id' | 'createdAt'>,
    recipientId: string,
  ): Promise<void> {
    const devices = await this.devices
      .find({
        userId: recipientId,
        active: true,
        registeredAt: { $lte: notification.createdAt },
      })
      .lean()
      .exec();
    for (const device of devices) {
      try {
        await this.deliveries
          .updateOne(
            {
              notificationId: notification.id,
              installationId: device.installationId,
            },
            {
              $setOnInsert: {
                notificationId: notification.id,
                recipientId,
                installationId: device.installationId,
                generation: device.generation,
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
    // Native collection avoids altering the feed model/API for the outbox marker.
    await this.notifications.collection.updateOne(
      { _id: new this.notifications.base.Types.ObjectId(notification.id) },
      { $set: { pushQueuedAt: new Date() } },
    );
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([this.devices.init(), this.deliveries.init()]);
    await this.notifications.collection.createIndex(
      { pushQueuedAt: 1, _id: 1 },
      { name: 'push_outbox_recovery' },
    );
    this.timer = setInterval(() => {
      if (!this.running) this.activeTick = this.tick();
    }, 5000);
    this.timer.unref();
    this.activeTick = this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.activeTick;
  }

  async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      const unqueued = await this.notifications.collection
        .find({ pushQueuedAt: { $exists: false }, deletedAt: null })
        .sort({ _id: 1 })
        .limit(100)
        .toArray();
      for (const row of unqueued) {
        if (this.stopping) return;
        await this.enqueue(
          { id: row._id.toString(), createdAt: row.createdAt },
          row.recipientId,
        );
      }
      if (!this.push.enabled) return;
      for (let i = 0; i < 50 && !this.stopping; i++) {
        const now = new Date();
        const leaseId = randomUUID();
        const job = await this.deliveries
          .findOneAndUpdate(
            {
              attempts: { $lt: MAX_ATTEMPTS },
              $or: [
                { status: 'pending', nextAttemptAt: { $lte: now } },
                { status: 'processing', leaseUntil: { $lte: now } },
              ],
            },
            {
              $set: {
                status: 'processing',
                leaseId,
                leaseUntil: new Date(now.getTime() + 120_000),
              },
              $inc: { attempts: 1 },
            },
            { returnDocument: 'after', sort: { nextAttemptAt: 1 } },
          )
          .lean()
          .exec();
        if (!job) break;
        await this.dispatch(job, leaseId);
      }
      // A worker may die on its final attempt; do not leave an eternal processing job.
      await this.deliveries
        .updateMany(
          {
            status: 'processing',
            attempts: { $gte: MAX_ATTEMPTS },
            leaseUntil: { $lte: new Date() },
          },
          { $set: { status: 'failed', errorCode: 'lease-expired' } },
        )
        .exec();
    } catch {
      // Never log errors containing credentials, registration IDs, or notification content.
      this.logger.warn(
        'Push dispatcher unavailable; persisted work will be retried',
      );
    } finally {
      this.running = false;
    }
  }

  private async dispatch(job: Delivery, leaseId: string): Promise<void> {
    const filter = {
      notificationId: job.notificationId,
      installationId: job.installationId,
      leaseId,
    };
    const device = await this.devices
      .findOne({
        installationId: job.installationId,
        userId: job.recipientId,
        generation: job.generation,
        active: true,
      })
      .lean()
      .exec();
    const notification = await this.notifications
      .findOne({
        _id: job.notificationId,
        recipientId: job.recipientId,
        deletedAt: null,
      })
      .lean()
      .exec();
    const preference = await this.preferences
      .findOne({ userId: job.recipientId })
      .lean()
      .exec();
    if (
      !device ||
      !notification ||
      preference?.items.some(
        (item) => item.category === notification.category && !item.push,
      )
    ) {
      await this.deliveries
        .updateOne(filter, { $set: { status: 'skipped' } })
        .exec();
      return;
    }
    try {
      const providerMessageId = await this.push.send(device.fid);
      await this.deliveries
        .updateOne(filter, {
          $set: { status: 'accepted', providerMessageId },
          $unset: { errorCode: 1 },
        })
        .exec();
    } catch (error) {
      const rawCode = (error as { code?: unknown })?.code;
      const code =
        typeof rawCode === 'string' && /^messaging\/[a-z-]+$/.test(rawCode)
          ? rawCode
          : 'provider-unavailable';
      const invalid = invalidRegistration(code);
      if (invalid)
        await this.devices
          .updateOne(
            {
              installationId: device.installationId,
              generation: device.generation,
            },
            { $set: { active: false, updatedAt: new Date() } },
          )
          .exec();
      await this.deliveries
        .updateOne(filter, {
          $set: {
            status:
              invalid || job.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            errorCode: code,
            nextAttemptAt: new Date(Date.now() + retryDelay(job.attempts)),
          },
        })
        .exec();
    }
  }

  private hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }
}
