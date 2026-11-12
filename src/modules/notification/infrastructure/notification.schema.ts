import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  type NotificationCategory,
  type NotificationMetadata,
  type NotificationPriority,
} from '../domain/notification.model';

@Schema({ collection: 'notifications', versionKey: false })
export class NotificationDocument {
  /** Keycloak user id (JWT sub) taken from trusted Gateway headers only. */
  @Prop({ type: String, required: true })
  recipientId: string;

  /** Idempotency key from the producing event; unique per recipient. */
  @Prop({ type: String, required: true })
  sourceEventId: string;

  @Prop({ type: String, enum: NOTIFICATION_CATEGORIES, required: true })
  category: NotificationCategory;

  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  body: string;

  @Prop({
    type: String,
    enum: NOTIFICATION_PRIORITIES,
    required: true,
    default: 'NORMAL',
  })
  priority: NotificationPriority;

  @Prop({ type: String, default: null })
  actionPath: string | null;

  @Prop({ type: Object, default: null })
  metadata: NotificationMetadata | null;

  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt: Date;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;
}

export type NotificationHydratedDocument =
  HydratedDocument<NotificationDocument>;
export const NotificationSchema =
  SchemaFactory.createForClass(NotificationDocument);

// At-least-once delivery: a replayed event can never create a second row.
NotificationSchema.index(
  { recipientId: 1, sourceEventId: 1 },
  { unique: true, name: 'uniq_recipient_source_event' },
);
// Feed: keyset pagination (createdAt desc, _id desc) scoped to one recipient.
NotificationSchema.index(
  { recipientId: 1, deletedAt: 1, createdAt: -1, _id: -1 },
  { name: 'recipient_feed' },
);
// Unread count / mark-all-read.
NotificationSchema.index(
  { recipientId: 1, deletedAt: 1, readAt: 1 },
  { name: 'recipient_unread' },
);
