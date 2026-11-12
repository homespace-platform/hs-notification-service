import type {
  FeedQuery,
  NewNotification,
  NotificationRecord,
  PreferenceItem,
} from './notification.model';

/**
 * Persistence port. Every method is scoped by recipientId/userId so a caller
 * can never address another user's data by id alone.
 */
export abstract class NotificationRepository {
  /** Idempotent insert keyed by (recipientId, sourceEventId). */
  abstract insertIfAbsent(
    input: NewNotification,
  ): Promise<{ record: NotificationRecord; created: boolean }>;

  abstract findFeed(
    recipientId: string,
    query: FeedQuery,
  ): Promise<NotificationRecord[]>;

  abstract countUnread(recipientId: string): Promise<number>;

  abstract markRead(
    recipientId: string,
    id: string,
    now: Date,
  ): Promise<NotificationRecord | null>;

  abstract markAllRead(recipientId: string, now: Date): Promise<number>;

  abstract softDelete(
    recipientId: string,
    id: string,
    now: Date,
  ): Promise<boolean>;
}

export abstract class NotificationPreferenceRepository {
  abstract find(userId: string): Promise<PreferenceItem[] | null>;
  abstract save(
    userId: string,
    items: PreferenceItem[],
    now: Date,
  ): Promise<void>;
}
