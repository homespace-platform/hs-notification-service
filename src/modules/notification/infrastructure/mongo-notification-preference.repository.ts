import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { PreferenceItem } from '../domain/notification.model';
import { NotificationPreferenceRepository } from '../domain/notification.repository';
import { NotificationPreferenceDocument } from './notification-preference.schema';

@Injectable()
export class MongoNotificationPreferenceRepository extends NotificationPreferenceRepository implements OnModuleInit {
  constructor(
    @InjectModel(NotificationPreferenceDocument.name)
    private readonly model: Model<NotificationPreferenceDocument>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.model.init();
  }

  async find(userId: string): Promise<PreferenceItem[] | null> {
    const doc = await this.model
      .findOne({ userId })
      .lean<NotificationPreferenceDocument>()
      .exec();
    if (!doc) return null;
    return doc.items.map(({ category, push, email }) => ({
      category,
      push,
      email,
    }));
  }

  async save(
    userId: string,
    items: PreferenceItem[],
    now: Date,
  ): Promise<void> {
    await this.model
      .updateOne(
        { userId },
        { $set: { items, updatedAt: now } },
        { upsert: true },
      )
      .exec();
  }
}
