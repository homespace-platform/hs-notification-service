import {
  NotificationPreferenceRepository,
  NotificationRepository,
} from '../domain/notification.repository';
import type {
  FeedQuery,
  NewNotification,
  NotificationRecord,
  PreferenceItem,
} from '../domain/notification.model';

/**
 * Test double mirroring the Mongo semantics the service relies on:
 * unique (recipientId, sourceEventId), recipient-scoped queries, soft delete,
 * and (createdAt desc, id desc) keyset ordering.
 */
export class InMemoryNotificationRepository extends NotificationRepository {
  readonly rows: NotificationRecord[] = [];
  private seq = 0;

  async insertIfAbsent(
    input: NewNotification,
  ): Promise<{ record: NotificationRecord; created: boolean }> {
    const existing = this.rows.find(
      (row) =>
        row.recipientId === input.recipientId &&
        row.sourceEventId === input.sourceEventId,
    );
    if (existing) return { record: { ...existing }, created: false };

    const record: NotificationRecord = {
      ...input,
      id: String(++this.seq).padStart(24, '0'),
      actionPath: input.actionPath ?? null,
      metadata: input.metadata ?? null,
      createdAt: input.createdAt ?? new Date(),
      readAt: null,
      deletedAt: null,
    };
    this.rows.push(record);
    return { record: { ...record }, created: true };
  }

  async findFeed(
    recipientId: string,
    query: FeedQuery,
  ): Promise<NotificationRecord[]> {
    const { cursor } = query;
    return this.rows
      .filter((row) => row.recipientId === recipientId && !row.deletedAt)
      .filter((row) => !query.category || row.category === query.category)
      .filter((row) => !query.unreadOnly || !row.readAt)
      .filter(
        (row) =>
          !cursor ||
          row.createdAt < cursor.createdAt ||
          (row.createdAt.getTime() === cursor.createdAt.getTime() &&
            row.id < cursor.id),
      )
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          (a.id < b.id ? 1 : -1),
      )
      .slice(0, query.limit)
      .map((row) => ({ ...row }));
  }

  async countUnread(recipientId: string): Promise<number> {
    return this.rows.filter(
      (row) => row.recipientId === recipientId && !row.deletedAt && !row.readAt,
    ).length;
  }

  async markRead(
    recipientId: string,
    id: string,
    now: Date,
  ): Promise<NotificationRecord | null> {
    const row = this.owned(recipientId, id);
    if (!row) return null;
    row.readAt ??= now;
    return { ...row };
  }

  async markAllRead(recipientId: string, now: Date): Promise<number> {
    const unread = this.rows.filter(
      (row) => row.recipientId === recipientId && !row.deletedAt && !row.readAt,
    );
    unread.forEach((row) => (row.readAt = now));
    return unread.length;
  }

  async softDelete(
    recipientId: string,
    id: string,
    now: Date,
  ): Promise<boolean> {
    const row = this.owned(recipientId, id);
    if (!row) return false;
    row.deletedAt = now;
    return true;
  }

  private owned(
    recipientId: string,
    id: string,
  ): NotificationRecord | undefined {
    return this.rows.find(
      (row) =>
        row.id === id && row.recipientId === recipientId && !row.deletedAt,
    );
  }
}

export class InMemoryPreferenceRepository extends NotificationPreferenceRepository {
  readonly store = new Map<string, PreferenceItem[]>();

  async find(userId: string): Promise<PreferenceItem[] | null> {
    return this.store.get(userId)?.map((item) => ({ ...item })) ?? null;
  }

  async save(userId: string, items: PreferenceItem[]): Promise<void> {
    this.store.set(
      userId,
      items.map((item) => ({ ...item })),
    );
  }
}
