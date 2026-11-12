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

/** External delivery preferences only. They never gate in-app storage. */
@Schema({ collection: 'notification_preferences', versionKey: false })
export class NotificationPreferenceDocument {
  @Prop({ type: String, required: true, unique: true })
  userId: string;

  @Prop({ type: [PreferenceEntrySchema], default: [] })
  items: PreferenceEntry[];

  @Prop({ type: Date, required: true })
  updatedAt: Date;
}

export const NotificationPreferenceSchema = SchemaFactory.createForClass(
  NotificationPreferenceDocument,
);
