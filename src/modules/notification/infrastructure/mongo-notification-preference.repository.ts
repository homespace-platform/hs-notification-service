import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationChannel,
  type PreferenceItem,
} from '../domain/notification.model';
import { NotificationPreferenceRepository } from '../domain/notification.repository';
import { NotificationPreferenceDocument } from './notification-preference.schema';

@Injectable()
export class MongoNotificationPreferenceRepository
  extends NotificationPreferenceRepository
  implements OnModuleInit
{
  constructor(
    @InjectModel(NotificationPreferenceDocument.name)
    private readonly model: Model<NotificationPreferenceDocument>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.model.init();
    // One-time: SYSTEM email used to default to true (unused, UI disabled), so stored true is not consent.
    await this.model.collection.updateMany(
      { emailOptInReset: { $ne: true } },
      [
        {
          $set: {
            emailOptInReset: true,
            items: {
              $map: {
                input: '$items',
                as: 'i',
                in: {
                  $cond: [
                    { $eq: ['$$i.category', 'SYSTEM'] },
                    { $mergeObjects: ['$$i', { email: false }] },
                    '$$i',
                  ],
                },
              },
            },
          },
        },
      ],
    );
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
        { $set: { items, updatedAt: now, emailOptInReset: true } },
        { upsert: true },
      )
      .exec();
  }

  async patch(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean,
    now: Date,
  ): Promise<PreferenceItem[]> {
    const pipeline = [
      {
        $set: {
          userId: { $literal: userId },
          updatedAt: now,
          emailOptInReset: true,
          items: {
            $map: {
              input: NOTIFICATION_CATEGORIES,
              as: 'category',
              in: {
                $mergeObjects: [
                  {
                    category: '$$category',
                    push: true,
                    email: { $ne: ['$$category', 'SYSTEM'] },
                  },
                  {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: { $ifNull: ['$items', []] },
                          as: 'item',
                          cond: { $eq: ['$$item.category', '$$category'] },
                        },
                      },
                      0,
                    ],
                  },
                  {
                    $cond: [
                      { $eq: ['$$category', category] },
                      { [channel]: enabled },
                      {},
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    ];
    const update = (upsert: boolean) =>
      this.model
        .findOneAndUpdate({ userId }, pipeline, {
          upsert,
          returnDocument: 'after',
          updatePipeline: true,
        })
        .lean<NotificationPreferenceDocument>()
        .exec();
    let doc: NotificationPreferenceDocument | null;
    try {
      doc = await update(true);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      // Concurrent first updates can race on the unique userId index.
      doc = await update(false);
    }
    if (!doc) throw new Error('Preference update unavailable');
    return doc.items;
  }
}
