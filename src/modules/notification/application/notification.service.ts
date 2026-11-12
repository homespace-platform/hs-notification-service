import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationDeliveryService } from '../../notification-delivery/notification-delivery.service';
import { NotificationRealtimeService } from '../../notification-realtime/notification-realtime.service';
import { ErrorCode } from '../../../common/constants/error-code.constant';
import { AppException } from '../../../common/exceptions/app.exception';
import { decodeCursor, encodeCursor } from '../domain/feed-cursor';
import {
  BODY_MAX,
  isSafeActionPath,
  isSafeMetadata,
  isValidType,
  SOURCE_EVENT_ID_MAX,
  TITLE_MAX,
} from '../domain/notification-content';
import {
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  type NewNotification,
  type NotificationCategory,
  type NotificationRecord,
  type PreferenceItem,
} from '../domain/notification.model';
import {
  NotificationPreferenceRepository,
  NotificationRepository,
} from '../domain/notification.repository';

export interface NotificationView {
  id: string;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string;
  priority: NotificationRecord['priority'];
  actionPath: string | null;
  metadata: NotificationRecord['metadata'];
  createdAt: Date;
  readAt: Date | null;
}

export interface FeedPage {
  items: NotificationView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface FeedRequest {
  limit?: number;
  cursor?: string;
  category?: NotificationCategory;
  unreadOnly?: boolean;
}

/** recipientId is a Keycloak userId; the endpoints never accept it from clients. */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly preferences: NotificationPreferenceRepository,
    @Optional() private readonly delivery?: NotificationDeliveryService,
    @Optional() private readonly realtime?: NotificationRealtimeService,
  ) {}

  /**
   * Internal ingestion entry point for later event consumers (no HTTP route).
   * Idempotent per (recipientId, sourceEventId). Delivery preferences are
   * deliberately NOT consulted: in-app notifications are always stored.
   */
  async create(
    input: NewNotification,
  ): Promise<{ notification: NotificationView; created: boolean }> {
    this.assertValid(input);
    const { record, created } = await this.notifications.insertIfAbsent(input);
    const notification = this.toView(record);
    try {
      // Replays repair a partial enqueue; Mongo recovery also covers a crash after insert.
      await this.delivery?.enqueue(notification, record.recipientId);
    } catch {
      this.logger.warn('Push enqueue deferred to durable recovery');
    }
    if (created && this.realtime) {
      try {
        this.realtime.emitNew(record.recipientId, notification);
        this.realtime.emitUnreadCount(
          record.recipientId,
          await this.notifications.countUnread(record.recipientId),
        );
      } catch {
        this.logger.warn(
          'Realtime notification deferred to client feed refresh',
        );
      }
    }
    return { notification, created };
  }

  async getFeed(recipientId: string, request: FeedRequest): Promise<FeedPage> {
    const limit = Math.min(
      Math.max(request.limit ?? FEED_DEFAULT_LIMIT, 1),
      FEED_MAX_LIMIT,
    );
    const cursor = request.cursor ? decodeCursor(request.cursor) : undefined;

    // Fetch one extra row to learn whether another page exists.
    const rows = await this.notifications.findFeed(recipientId, {
      limit: limit + 1,
      cursor,
      category: request.category,
      unreadOnly: request.unreadOnly,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((row) => this.toView(row)),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      hasMore,
    };
  }

  async getUnreadCount(recipientId: string): Promise<{ count: number }> {
    return { count: await this.notifications.countUnread(recipientId) };
  }

  async markRead(recipientId: string, id: string): Promise<NotificationView> {
    const record = await this.notifications.markRead(
      recipientId,
      id,
      new Date(),
    );
    if (!record) throw new AppException(ErrorCode.NOTIFICATION_NOT_FOUND);
    return this.toView(record);
  }

  async markAllRead(recipientId: string): Promise<{ updated: number }> {
    return {
      updated: await this.notifications.markAllRead(recipientId, new Date()),
    };
  }

  async delete(recipientId: string, id: string): Promise<void> {
    const deleted = await this.notifications.softDelete(
      recipientId,
      id,
      new Date(),
    );
    if (!deleted) throw new AppException(ErrorCode.NOTIFICATION_NOT_FOUND);
  }

  async getPreferences(userId: string): Promise<PreferenceItem[]> {
    return this.withDefaults(await this.preferences.find(userId));
  }

  async updatePreferences(
    userId: string,
    items: PreferenceItem[],
  ): Promise<PreferenceItem[]> {
    const categories = new Set(items.map((item) => item.category));
    if (categories.size !== items.length) {
      throw new AppException(ErrorCode.INVALID_PREFERENCES);
    }
    const normalized = this.withDefaults(items);
    await this.preferences.save(userId, normalized, new Date());
    return normalized;
  }

  /** Categories not configured fall back to enabled for every channel. */
  private withDefaults(items: PreferenceItem[] | null): PreferenceItem[] {
    const byCategory = new Map(items?.map((item) => [item.category, item]));
    return NOTIFICATION_CATEGORIES.map((category) => {
      const item = byCategory.get(category);
      return {
        category,
        push: item?.push ?? true,
        email: item?.email ?? true,
      };
    });
  }

  private assertValid(input: NewNotification): void {
    const valid =
      input.recipientId.trim().length > 0 &&
      input.sourceEventId.length > 0 &&
      input.sourceEventId.length <= SOURCE_EVENT_ID_MAX &&
      NOTIFICATION_CATEGORIES.includes(input.category) &&
      NOTIFICATION_PRIORITIES.includes(input.priority) &&
      isValidType(input.type) &&
      input.title.trim().length > 0 &&
      input.title.length <= TITLE_MAX &&
      input.body.trim().length > 0 &&
      input.body.length <= BODY_MAX &&
      (input.actionPath == null || isSafeActionPath(input.actionPath)) &&
      (input.metadata == null || isSafeMetadata(input.metadata));
    // Message intentionally carries no content: it may contain personal data.
    if (!valid) throw new Error('Invalid notification payload');
  }

  private toView(record: NotificationRecord): NotificationView {
    return {
      id: record.id,
      category: record.category,
      type: record.type,
      title: record.title,
      body: record.body,
      priority: record.priority,
      actionPath: record.actionPath,
      metadata: record.metadata,
      createdAt: record.createdAt,
      readAt: record.readAt,
    };
  }
}
