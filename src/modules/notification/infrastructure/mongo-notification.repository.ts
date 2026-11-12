import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type QueryFilter } from 'mongoose';
import type {
  FeedQuery,
  NewNotification,
  NotificationRecord,
} from '../domain/notification.model';
import { NotificationRepository } from '../domain/notification.repository';
import { NotificationDocument } from './notification.schema';

const DUPLICATE_KEY = 11000;

type LeanNotification = NotificationDocument & { _id: Types.ObjectId };

export function toRecord(doc: LeanNotification): NotificationRecord {
  return {
    id: doc._id.toHexString(),
    recipientId: doc.recipientId,
    sourceEventId: doc.sourceEventId,
    category: doc.category,
    type: doc.type,
    title: doc.title,
    body: doc.body,
    priority: doc.priority,
    actionPath: doc.actionPath ?? null,
    metadata: doc.metadata ?? null,
    createdAt: doc.createdAt,
    readAt: doc.readAt ?? null,
    deletedAt: doc.deletedAt ?? null,
  };
}

/** Builds the feed filter; recipientId and deletedAt are always enforced. */
export function buildFeedFilter(
  recipientId: string,
  query: Omit<FeedQuery, 'limit'>,
): QueryFilter<NotificationDocument> {
  const filter: QueryFilter<NotificationDocument> = {
    recipientId,
    deletedAt: null,
  };
  if (query.category) filter.category = query.category;
  if (query.unreadOnly) filter.readAt = null;
  if (query.cursor) {
    const id = new Types.ObjectId(query.cursor.id);
    filter.$or = [
      { createdAt: { $lt: query.cursor.createdAt } },
      { createdAt: query.cursor.createdAt, _id: { $lt: id } },
    ];
  }
  return filter;
}

@Injectable()
export class MongoNotificationRepository extends NotificationRepository implements OnModuleInit {
  constructor(
    @InjectModel(NotificationDocument.name)
    private readonly model: Model<NotificationDocument>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // Consumption must not race unique-index creation on a fresh database.
    await this.model.init();
  }

  async insertIfAbsent(
    input: NewNotification,
  ): Promise<{ record: NotificationRecord; created: boolean }> {
    try {
      const created = await this.model.create({
        ...input,
        actionPath: input.actionPath ?? null,
        metadata: input.metadata ?? null,
        createdAt: input.createdAt ?? new Date(),
        readAt: null,
        deletedAt: null,
      });
      return {
        record: toRecord(created.toObject() as LeanNotification),
        created: true,
      };
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      const existing = await this.model
        .findOne({
          recipientId: input.recipientId,
          sourceEventId: input.sourceEventId,
        })
        .lean<LeanNotification>()
        .exec();
      if (!existing) throw error;
      return { record: toRecord(existing), created: false };
    }
  }

  async findFeed(
    recipientId: string,
    query: FeedQuery,
  ): Promise<NotificationRecord[]> {
    const docs = await this.model
      .find(buildFeedFilter(recipientId, query))
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit)
      .lean<LeanNotification[]>()
      .exec();
    return docs.map(toRecord);
  }

  countUnread(recipientId: string): Promise<number> {
    return this.model
      .countDocuments({ recipientId, deletedAt: null, readAt: null })
      .exec();
  }

  async markRead(
    recipientId: string,
    id: string,
    now: Date,
  ): Promise<NotificationRecord | null> {
    const _id = new Types.ObjectId(id);
    const updated = await this.model
      .findOneAndUpdate(
        { _id, recipientId, deletedAt: null, readAt: null },
        { $set: { readAt: now } },
        { returnDocument: 'after' },
      )
      .lean<LeanNotification>()
      .exec();
    if (updated) return toRecord(updated);

    // Already read (idempotent) or not owned/deleted (indistinguishable → null).
    const existing = await this.model
      .findOne({ _id, recipientId, deletedAt: null })
      .lean<LeanNotification>()
      .exec();
    return existing ? toRecord(existing) : null;
  }

  async markAllRead(recipientId: string, now: Date): Promise<number> {
    const result = await this.model
      .updateMany(
        { recipientId, deletedAt: null, readAt: null },
        { $set: { readAt: now } },
      )
      .exec();
    return result.modifiedCount;
  }

  async softDelete(
    recipientId: string,
    id: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: new Types.ObjectId(id), recipientId, deletedAt: null },
        { $set: { deletedAt: now } },
      )
      .exec();
    return result.matchedCount > 0;
  }
}
