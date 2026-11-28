export const NOTIFICATION_CATEGORIES = [
  'SYSTEM',
  'ACCOUNT',
  'LISTING',
  'APPOINTMENT',
  'CONTRACT',
  'PAYMENT',
  'CHAT',
  'RENTAL_REQUEST',
  'NEWS',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_PRIORITIES = [
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT',
] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

/** Owner decision 28/11: for users who never chose, every channel is ON (email only goes out where a template exists). */
export const EMAIL_DEFAULT_ON_CATEGORIES: readonly NotificationCategory[] = NOTIFICATION_CATEGORIES;
export const emailDefault = (category: NotificationCategory): boolean => EMAIL_DEFAULT_ON_CATEGORIES.includes(category);

export const NOTIFICATION_CHANNELS = ['push', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const FEED_DEFAULT_LIMIT = 20;
export const FEED_MAX_LIMIT = 50;

export type NotificationMetadata = Record<string, string | number | boolean>;

/** Persisted notification, always scoped to one recipient (Keycloak userId). */
export interface NotificationRecord {
  id: string;
  recipientId: string;
  sourceEventId: string;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  actionPath: string | null;
  metadata: NotificationMetadata | null;
  createdAt: Date;
  readAt: Date | null;
  deletedAt: Date | null;
}

export type NewNotification = Omit<
  NotificationRecord,
  'id' | 'createdAt' | 'readAt' | 'deletedAt' | 'actionPath' | 'metadata'
> & {
  actionPath?: string | null;
  metadata?: NotificationMetadata | null;
  createdAt?: Date;
};

export interface FeedCursor {
  createdAt: Date;
  id: string;
}

export interface FeedQuery {
  limit: number;
  cursor?: FeedCursor;
  category?: NotificationCategory;
  unreadOnly?: boolean;
}

export interface PreferenceItem {
  category: NotificationCategory;
  push: boolean;
  email: boolean;
}
