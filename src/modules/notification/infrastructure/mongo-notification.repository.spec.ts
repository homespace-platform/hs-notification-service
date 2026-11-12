import { Types } from 'mongoose';
import type { NewNotification } from '../domain/notification.model';
import {
  buildFeedFilter,
  MongoNotificationRepository,
} from './mongo-notification.repository';

const ID = new Types.ObjectId().toHexString();

/** Minimal chainable stand-in for a Mongoose query. */
function query<T>(value: T) {
  const q = {
    sort: () => q,
    limit: () => q,
    lean: () => q,
    exec: async () => value,
  };
  return q;
}

const NEW_NOTIFICATION: NewNotification = {
  recipientId: 'u1',
  sourceEventId: 'e1',
  category: 'CHAT',
  type: 'CHAT_MESSAGE',
  title: 't',
  body: 'b',
  priority: 'NORMAL',
};

describe('buildFeedFilter', () => {
  it('always scopes to the recipient and hides soft-deleted rows', () => {
    expect(buildFeedFilter('u1', {})).toEqual({
      recipientId: 'u1',
      deletedAt: null,
    });
  });

  it('adds keyset (createdAt, _id) cursor, category and unread filters', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const filter = buildFeedFilter('u1', {
      category: 'CHAT',
      unreadOnly: true,
      cursor: { createdAt, id: ID },
    });
    expect(filter).toMatchObject({
      recipientId: 'u1',
      deletedAt: null,
      category: 'CHAT',
      readAt: null,
    });
    expect(filter.$or).toEqual([
      { createdAt: { $lt: createdAt } },
      { createdAt, _id: { $lt: new Types.ObjectId(ID) } },
    ]);
    expect(filter).not.toHaveProperty('skip');
  });
});

describe('MongoNotificationRepository', () => {
  it('fails startup when required indexes cannot initialize', async () => {
    const repository = new MongoNotificationRepository({
      init: async () => { throw new Error('index unavailable'); },
    } as never);
    await expect(repository.onModuleInit()).rejects.toThrow('index unavailable');
  });
  it('scopes id-based mutations by recipientId', async () => {
    const filters: Record<string, unknown>[] = [];
    const model = {
      findOneAndUpdate: (filter: Record<string, unknown>) => {
        filters.push(filter);
        return query(null);
      },
      findOne: (filter: Record<string, unknown>) => {
        filters.push(filter);
        return query(null);
      },
      updateOne: (filter: Record<string, unknown>) => {
        filters.push(filter);
        return query({ matchedCount: 0 });
      },
    };
    const repo = new MongoNotificationRepository(model as never);

    expect(await repo.markRead('u1', ID, new Date())).toBeNull();
    expect(await repo.softDelete('u1', ID, new Date())).toBe(false);

    expect(filters).toHaveLength(3);
    for (const filter of filters) {
      expect(filter).toMatchObject({ recipientId: 'u1', deletedAt: null });
    }
  });

  it('returns the existing row when a duplicate key error occurs', async () => {
    const existing = {
      _id: new Types.ObjectId(ID),
      ...NEW_NOTIFICATION,
      actionPath: null,
      metadata: null,
      createdAt: new Date(),
      readAt: null,
      deletedAt: null,
    };
    let lookup: unknown;
    const model = {
      create: async () => Promise.reject({ code: 11000 }),
      findOne: (filter: unknown) => {
        lookup = filter;
        return query(existing);
      },
    };
    const repo = new MongoNotificationRepository(model as never);

    const result = await repo.insertIfAbsent(NEW_NOTIFICATION);

    expect(result.created).toBe(false);
    expect(result.record.id).toBe(ID);
    expect(lookup).toEqual({ recipientId: 'u1', sourceEventId: 'e1' });
  });

  it('rethrows non-duplicate errors', async () => {
    const model = {
      create: async () => Promise.reject(new Error('boom')),
    };
    const repo = new MongoNotificationRepository(model as never);
    await expect(repo.insertIfAbsent(NEW_NOTIFICATION)).rejects.toThrow('boom');
  });
});
