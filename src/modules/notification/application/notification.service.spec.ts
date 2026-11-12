import { ErrorCode } from '../../../common/constants/error-code.constant';
import { decodeCursor, encodeCursor } from '../domain/feed-cursor';
import type { NewNotification } from '../domain/notification.model';
import {
  InMemoryNotificationRepository,
  InMemoryPreferenceRepository,
} from '../testing/in-memory-notification.repository';
import { NotificationService } from './notification.service';

const ALICE = 'alice-keycloak-id';
const BOB = 'bob-keycloak-id';
const T0 = Date.parse('2026-01-01T00:00:00.000Z');

function setup() {
  const notifications = new InMemoryNotificationRepository();
  const preferences = new InMemoryPreferenceRepository();
  const service = new NotificationService(notifications, preferences);
  return { service, notifications, preferences };
}

function input(overrides: Partial<NewNotification> = {}): NewNotification {
  return {
    recipientId: ALICE,
    sourceEventId: 'evt-1',
    category: 'PAYMENT',
    type: 'PAYMENT_RECEIVED',
    title: 'Payment received',
    body: 'Your payment was received.',
    priority: 'NORMAL',
    createdAt: new Date(T0),
    ...overrides,
  };
}

async function seed(
  service: NotificationService,
  recipientId: string,
  count: number,
  offset = 0,
) {
  for (let i = 0; i < count; i++) {
    await service.create(
      input({
        recipientId,
        sourceEventId: `${recipientId}-evt-${offset + i}`,
        title: `n${offset + i}`,
        createdAt: new Date(T0 + (offset + i) * 1000),
      }),
    );
  }
}

describe('NotificationService', () => {
  describe('create (idempotent ingestion)', () => {
    it('stores one row for a replayed (recipientId, sourceEventId)', async () => {
      const { service, notifications } = setup();

      const first = await service.create(input());
      const replay = await service.create(input({ title: 'Replayed' }));

      expect(first.created).toBe(true);
      expect(replay.created).toBe(false);
      expect(replay.notification.id).toBe(first.notification.id);
      expect(notifications.rows).toHaveLength(1);
      expect(notifications.rows[0].title).toBe('Payment received');
    });

    it('allows the same sourceEventId for different recipients', async () => {
      const { service, notifications } = setup();
      await service.create(input({ recipientId: ALICE }));
      await service.create(input({ recipientId: BOB }));
      expect(notifications.rows).toHaveLength(2);
    });

    it('does not resurrect a soft-deleted notification on replay', async () => {
      const { service } = setup();
      const { notification } = await service.create(input());
      await service.delete(ALICE, notification.id);

      const replay = await service.create(input());

      expect(replay.created).toBe(false);
      expect((await service.getFeed(ALICE, {})).items).toHaveLength(0);
      expect(await service.getUnreadCount(ALICE)).toEqual({ count: 0 });
    });

    it('stores in-app notifications regardless of delivery preferences', async () => {
      const { service, notifications } = setup();
      await service.updatePreferences(
        ALICE,
        ['SYSTEM', 'PAYMENT'].map((category) => ({
          category: category as 'SYSTEM' | 'PAYMENT',
          push: false,
          email: false,
        })),
      );

      const { created } = await service.create(input({ category: 'PAYMENT' }));

      expect(created).toBe(true);
      expect(notifications.rows).toHaveLength(1);
      expect((await service.getFeed(ALICE, {})).items).toHaveLength(1);
    });

    it.each([
      ['absolute URL', { actionPath: 'https://evil.example/x' }],
      ['protocol-relative URL', { actionPath: '//evil.example/x' }],
      ['backslash host', { actionPath: '/\\evil.example' }],
      ['javascript scheme', { actionPath: 'javascript:alert(1)' }],
      ['non-rooted path', { actionPath: 'contracts/1' }],
      ['path traversal', { actionPath: '/a/../admin' }],
      ['whitespace in path', { actionPath: '/a b' }],
      ['nested metadata', { metadata: { a: { b: 1 } as never } }],
      ['bad metadata key', { metadata: { 'a.b': 'x' } }],
      ['unknown category', { category: 'NOPE' as never }],
      ['lowercase type', { type: 'payment_received' }],
      ['empty title', { title: '  ' }],
    ])('rejects unsafe content: %s', async (_label, overrides) => {
      const { service, notifications } = setup();
      await expect(
        service.create(input(overrides as Partial<NewNotification>)),
      ).rejects.toThrow('Invalid notification payload');
      expect(notifications.rows).toHaveLength(0);
    });

    it('accepts a safe relative actionPath and flat metadata', async () => {
      const { service } = setup();
      const { notification } = await service.create(
        input({
          actionPath: '/contracts/123?tab=payments#top',
          metadata: { contractId: '123', amount: 1000, paid: true },
        }),
      );
      expect(notification.actionPath).toBe('/contracts/123?tab=payments#top');
      expect(notification.metadata).toEqual({
        contractId: '123',
        amount: 1000,
        paid: true,
      });
    });

    it('does not expose recipientId or sourceEventId in views', async () => {
      const { service } = setup();
      const { notification } = await service.create(input());
      expect(notification).not.toHaveProperty('recipientId');
      expect(notification).not.toHaveProperty('sourceEventId');
      expect(notification).not.toHaveProperty('deletedAt');
    });
  });

  describe('feed', () => {
    it('only returns the caller’s notifications (cross-user isolation)', async () => {
      const { service } = setup();
      await seed(service, ALICE, 3);
      await seed(service, BOB, 2);

      const alice = await service.getFeed(ALICE, {});
      const bob = await service.getFeed(BOB, {});

      expect(alice.items).toHaveLength(3);
      expect(bob.items).toHaveLength(2);
      expect(await service.getFeed('stranger', {})).toEqual({
        items: [],
        nextCursor: null,
        hasMore: false,
      });
    });

    it('paginates newest-first with a stable cursor and no duplicates/gaps', async () => {
      const { service } = setup();
      await seed(service, ALICE, 5);

      const page1 = await service.getFeed(ALICE, { limit: 2 });
      expect(page1.items.map((n) => n.title)).toEqual(['n4', 'n3']);
      expect(page1.hasMore).toBe(true);

      // New notifications arrive between page fetches: older pages must not shift.
      await seed(service, ALICE, 2, 100);

      const page2 = await service.getFeed(ALICE, {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((n) => n.title)).toEqual(['n2', 'n1']);

      const page3 = await service.getFeed(ALICE, {
        limit: 2,
        cursor: page2.nextCursor!,
      });
      expect(page3.items.map((n) => n.title)).toEqual(['n0']);
      expect(page3.hasMore).toBe(false);
      expect(page3.nextCursor).toBeNull();
    });

    it('keeps the cursor valid when the boundary item is deleted', async () => {
      const { service } = setup();
      await seed(service, ALICE, 4);
      const page1 = await service.getFeed(ALICE, { limit: 2 });
      await service.delete(ALICE, page1.items[1].id);

      const page2 = await service.getFeed(ALICE, {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((n) => n.title)).toEqual(['n1', 'n0']);
    });

    it('breaks createdAt ties by id without skipping or repeating rows', async () => {
      const { service } = setup();
      for (let i = 0; i < 5; i++) {
        await service.create(
          input({
            sourceEventId: `tie-${i}`,
            title: `t${i}`,
            createdAt: new Date(T0),
          }),
        );
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await service.getFeed(ALICE, { limit: 2, cursor });
        seen.push(...page.items.map((n) => n.title));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(seen).toEqual(['t4', 't3', 't2', 't1', 't0']);
    });

    it('filters by category and unreadOnly', async () => {
      const { service } = setup();
      const a = await service.create(
        input({ sourceEventId: 'a', category: 'CONTRACT', title: 'a' }),
      );
      await service.create(
        input({
          sourceEventId: 'b',
          category: 'PAYMENT',
          title: 'b',
          createdAt: new Date(T0 + 1000),
        }),
      );
      await service.markRead(ALICE, a.notification.id);

      expect(
        (await service.getFeed(ALICE, { category: 'CONTRACT' })).items,
      ).toHaveLength(1);
      expect(
        (await service.getFeed(ALICE, { unreadOnly: true })).items.map(
          (n) => n.title,
        ),
      ).toEqual(['b']);
    });

    it('clamps limit to the allowed range', async () => {
      const { service } = setup();
      await seed(service, ALICE, 60);
      expect(
        (await service.getFeed(ALICE, { limit: 1000 })).items,
      ).toHaveLength(50);
      expect((await service.getFeed(ALICE, { limit: 0 })).items).toHaveLength(
        1,
      );
    });

    it('rejects malformed cursors', async () => {
      const { service } = setup();
      for (const cursor of [
        'not-a-cursor',
        Buffer.from('{"c":"x","i":"y"}').toString('base64url'),
        Buffer.from('{"c":1,"i":"zzzz"}').toString('base64url'),
        'A'.repeat(500),
      ]) {
        await expect(service.getFeed(ALICE, { cursor })).rejects.toMatchObject({
          definition: ErrorCode.INVALID_CURSOR,
        });
      }
    });

    it('round-trips cursors', () => {
      const cursor = { createdAt: new Date(T0), id: 'a'.repeat(24) };
      expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    });

    it('a cursor from another user cannot reveal that user’s data', async () => {
      const { service } = setup();
      await seed(service, ALICE, 3);
      for (let i = 0; i < 3; i++) {
        await service.create(
          input({
            recipientId: BOB,
            sourceEventId: `bob-${i}`,
            title: `bob-secret-${i}`,
            createdAt: new Date(T0 + i * 1000),
          }),
        );
      }
      const bobPage = await service.getFeed(BOB, { limit: 1 });

      const aliceView = await service.getFeed(ALICE, {
        cursor: bobPage.nextCursor!,
      });
      expect(aliceView.items.length).toBeGreaterThan(0);
      expect(
        aliceView.items.every((n) => !n.title.startsWith('bob-secret')),
      ).toBe(true);
    });
  });

  describe('unread count / read state', () => {
    it('counts only the caller’s unread, non-deleted notifications', async () => {
      const { service } = setup();
      await seed(service, ALICE, 3);
      await seed(service, BOB, 5);
      expect(await service.getUnreadCount(ALICE)).toEqual({ count: 3 });

      const [first, second] = (await service.getFeed(ALICE, {})).items;
      await service.markRead(ALICE, first.id);
      await service.delete(ALICE, second.id);

      expect(await service.getUnreadCount(ALICE)).toEqual({ count: 1 });
      expect(await service.getUnreadCount(BOB)).toEqual({ count: 5 });
    });

    it('markRead is idempotent and keeps the first readAt', async () => {
      const { service } = setup();
      const { notification } = await service.create(input());

      const first = await service.markRead(ALICE, notification.id);
      const second = await service.markRead(ALICE, notification.id);

      expect(first.readAt).toBeInstanceOf(Date);
      expect(second.readAt).toEqual(first.readAt);
    });

    it('does not let another user mark a notification as read', async () => {
      const { service, notifications } = setup();
      const { notification } = await service.create(input());

      await expect(
        service.markRead(BOB, notification.id),
      ).rejects.toMatchObject({ definition: ErrorCode.NOTIFICATION_NOT_FOUND });
      expect(notifications.rows[0].readAt).toBeNull();
    });

    it('markAllRead affects only the caller', async () => {
      const { service } = setup();
      await seed(service, ALICE, 3);
      await seed(service, BOB, 2);

      expect(await service.markAllRead(ALICE)).toEqual({ updated: 3 });
      expect(await service.getUnreadCount(ALICE)).toEqual({ count: 0 });
      expect(await service.getUnreadCount(BOB)).toEqual({ count: 2 });
      expect(await service.markAllRead(ALICE)).toEqual({ updated: 0 });
    });
  });

  describe('delete (soft)', () => {
    it('soft-deletes for the owner and hides it from feed and count', async () => {
      const { service, notifications } = setup();
      const { notification } = await service.create(input());

      await service.delete(ALICE, notification.id);

      expect(notifications.rows).toHaveLength(1);
      expect(notifications.rows[0].deletedAt).toBeInstanceOf(Date);
      expect((await service.getFeed(ALICE, {})).items).toHaveLength(0);
      await expect(
        service.delete(ALICE, notification.id),
      ).rejects.toMatchObject({
        definition: ErrorCode.NOTIFICATION_NOT_FOUND,
      });
    });

    it('cannot delete another user’s notification', async () => {
      const { service, notifications } = setup();
      const { notification } = await service.create(input());

      await expect(service.delete(BOB, notification.id)).rejects.toMatchObject({
        definition: ErrorCode.NOTIFICATION_NOT_FOUND,
      });
      expect(notifications.rows[0].deletedAt).toBeNull();
    });

    it('cannot mark a deleted notification as read', async () => {
      const { service } = setup();
      const { notification } = await service.create(input());
      await service.delete(ALICE, notification.id);
      await expect(
        service.markRead(ALICE, notification.id),
      ).rejects.toMatchObject({ definition: ErrorCode.NOTIFICATION_NOT_FOUND });
    });
  });

  describe('preferences', () => {
    it('defaults every category to enabled', async () => {
      const { service } = setup();
      const items = await service.getPreferences(ALICE);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.push && i.email)).toBe(true);
    });

    it('stores per-user preferences without affecting other users', async () => {
      const { service } = setup();
      const updated = await service.updatePreferences(ALICE, [
        { category: 'CHAT', push: false, email: true },
      ]);
      expect(updated.find((i) => i.category === 'CHAT')).toEqual({
        category: 'CHAT',
        push: false,
        email: true,
      });
      expect(
        (await service.getPreferences(ALICE)).find((i) => i.category === 'CHAT')
          ?.push,
      ).toBe(false);
      expect(
        (await service.getPreferences(BOB)).find((i) => i.category === 'CHAT')
          ?.push,
      ).toBe(true);
    });

    it('rejects duplicate categories', async () => {
      const { service } = setup();
      await expect(
        service.updatePreferences(ALICE, [
          { category: 'CHAT', push: true, email: true },
          { category: 'CHAT', push: false, email: false },
        ]),
      ).rejects.toMatchObject({ definition: ErrorCode.INVALID_PREFERENCES });
    });
  });
});
