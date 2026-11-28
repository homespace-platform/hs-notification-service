import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from '../domain/notification.model';

@Schema({ _id: false })
export class PreferenceEntry {
  @Prop({ type: String, enum: NOTIFICATION_CATEGORIES, required: true })
  category: NotificationCategory;

  @Prop({ type: Boolean, required: true })
  push: boolean;

  @Prop({ type: Boolean, required: true })
  email: boolean;
}
const PreferenceEntrySchema = SchemaFactory.createForClass(PreferenceEntry);

/** Delivery/popup preferences never gate in-app storage or unread counts. */
@Schema({ collection: 'notification_preferences', versionKey: false })
export class NotificationPreferenceDocument {
  @Prop({ type: String, required: true, unique: true })
  userId: string;

  @Prop({ type: [PreferenceEntrySchema], default: [] })
  items: PreferenceEntry[];

  /** Marks docs already migrated to SYSTEM email opt-in (default off). */
  @Prop({ type: Boolean })
  emailOptInReset?: boolean;

  /** Marks docs migrated to per-category email defaults (PAYMENT/CONTRACT on, others off, SYSTEM untouched). */
  @Prop({ type: Boolean })
  emailDefaultsV2?: boolean;

  @Prop({ type: Date, required: true })
  updatedAt: Date;
}

export const NotificationPreferenceSchema = SchemaFactory.createForClass(
  NotificationPreferenceDocument,
);
