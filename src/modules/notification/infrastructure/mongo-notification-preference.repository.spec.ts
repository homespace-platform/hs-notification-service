import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { createConnection, type Connection, type Model } from 'mongoose';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
} from '../domain/notification.model';
import { MongoNotificationPreferenceRepository } from './mongo-notification-preference.repository';
import {
  NotificationPreferenceDocument,
  NotificationPreferenceSchema,
} from './notification-preference.schema';

describe('MongoNotificationPreferenceRepository patch', () => {
  it('retries a concurrent first-upsert duplicate without replacing the existing snapshot', async () => {
    const items = [{ category: 'NEWS', push: false, email: true }];
    const exec = jest
      .fn<() => Promise<{ items: typeof items }>>()
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValue({ items });
    const findOneAndUpdate = jest.fn(() => ({ lean: () => ({ exec }) }));
    const repository = new MongoNotificationPreferenceRepository({
      findOneAndUpdate,
    } as never);

    expect(
      await repository.patch('alice', 'NEWS', 'push', false, new Date()),
    ).toEqual(items);
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(findOneAndUpdate.mock.calls[0]).toEqual([
      { userId: 'alice' },
      expect.any(Array),
      { upsert: true, returnDocument: 'after', updatePipeline: true },
    ]);
    expect(findOneAndUpdate.mock.calls[1]).toEqual([
      { userId: 'alice' },
      expect.any(Array),
      { upsert: false, returnDocument: 'after', updatePipeline: true },
    ]);
  });

  it('propagates storage errors without an unsafe snapshot fallback', async () => {
    const exec = jest
      .fn<() => Promise<never>>()
      .mockRejectedValue(new Error('unavailable'));
    const findOneAndUpdate = jest.fn(() => ({ lean: () => ({ exec }) }));
    const repository = new MongoNotificationPreferenceRepository({
      findOneAndUpdate,
    } as never);
    await expect(
      repository.patch('alice', 'NEWS', 'push', false, new Date()),
    ).rejects.toThrow('unavailable');
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});

// Opt-in only; a fresh isolated database is retained, never an application database.
const mongoDescribe = process.env.TEST_MONGODB_URI ? describe : describe.skip;
mongoDescribe('atomic preference patches (Mongo)', () => {
  let connection: Connection;
  let model: Model<NotificationPreferenceDocument>;
  let repository: MongoNotificationPreferenceRepository;

  beforeAll(async () => {
    connection = await createConnection(process.env.TEST_MONGODB_URI!, {
      dbName: `notification_preference_test_${randomUUID().replace(/-/g, '')}`,
    }).asPromise();
    model = connection.model<NotificationPreferenceDocument>(
      NotificationPreferenceDocument.name,
      NotificationPreferenceSchema,
    );
    repository = new MongoNotificationPreferenceRepository(model);
    await repository.onModuleInit();
  });

  afterAll(async () => {
    await connection?.close();
  });

  it('preserves all category/channel updates during concurrent first upserts', async () => {
    const userId = randomUUID();
    await Promise.all(
      NOTIFICATION_CATEGORIES.flatMap((category) =>
        NOTIFICATION_CHANNELS.map((channel) =>
          repository.patch(userId, category, channel, false, new Date()),
        ),
      ),
    );

    expect(await repository.find(userId)).toEqual(
      NOTIFICATION_CATEGORIES.map((category) => ({
        category,
        push: false,
        email: false,
      })),
    );
    expect(await model.countDocuments({ userId })).toBe(1);
  });

  it('preserves older partial preferences and concurrent updates to other categories and channels', async () => {
    const userId = randomUUID();
    await repository.save(
      userId,
      [{ category: 'NEWS', push: false, email: true }],
      new Date(),
    );
    const stale = await repository.find(userId);
    await Promise.all([
      repository.patch(userId, 'NEWS', 'email', false, new Date()),
      repository.patch(userId, 'PAYMENT', 'push', false, new Date()),
      repository.patch(userId, 'CHAT', 'push', false, new Date()),
    ]);

    expect(stale).toEqual([{ category: 'NEWS', push: false, email: true }]);
    expect(await repository.find(userId)).toEqual(
      expect.arrayContaining([
        { category: 'NEWS', push: false, email: false },
        { category: 'PAYMENT', push: false, email: true },
        { category: 'CHAT', push: false, email: true },
      ]),
    );
  });

  it('defaults an unconfigured category/channel to enabled and isolates users', async () => {
    const alice = randomUUID();
    const bob = randomUUID();
    const items = await repository.patch(
      alice,
      'NEWS',
      'email',
      false,
      new Date(),
    );
    expect(items.find((item) => item.category === 'NEWS')).toEqual({
      category: 'NEWS',
      push: true,
      email: false,
    });
    expect(
      items
        .filter((item) => item.category !== 'NEWS')
        .every((item) => item.push && item.email),
    ).toBe(true);
    expect(await repository.find(bob)).toBeNull();
    const bobItems = await repository.patch(
      bob,
      'NEWS',
      'push',
      false,
      new Date(),
    );
    expect(bobItems.find((item) => item.category === 'NEWS')).toEqual({
      category: 'NEWS',
      push: false,
      email: true,
    });
    expect(await repository.find(alice)).toEqual(items);
  });
});
