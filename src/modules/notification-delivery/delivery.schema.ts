import { Schema } from 'mongoose';

export const DEVICE_MODEL = 'NotificationDevice';
export interface Device {
  installationId: string;
  secretHash: string;
  userId: string;
  fid: string;
  generation: string;
  active: boolean;
  registeredAt: Date;
  updatedAt: Date;
}
export const DeviceSchema = new Schema<Device>(
  {
    installationId: { type: String, required: true, unique: true },
    secretHash: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    fid: { type: String, required: true, unique: true },
    generation: { type: String, required: true },
    active: { type: Boolean, required: true },
    registeredAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'notification_devices', versionKey: false },
);

export const DELIVERY_MODEL = 'NotificationDelivery';
export interface Delivery {
  notificationId: string;
  recipientId: string;
  installationId: string;
  generation: string;
  status: 'pending' | 'processing' | 'accepted' | 'skipped' | 'failed';
  attempts: number;
  nextAttemptAt: Date;
  leaseId?: string;
  leaseUntil?: Date;
  providerMessageId?: string;
  errorCode?: string;
}
export const DeliverySchema = new Schema<Delivery>(
  {
    notificationId: { type: String, required: true },
    recipientId: { type: String, required: true },
    installationId: { type: String, required: true },
    generation: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'processing', 'accepted', 'skipped', 'failed'],
    },
    attempts: { type: Number, required: true },
    nextAttemptAt: { type: Date, required: true },
    leaseId: String,
    leaseUntil: Date,
    providerMessageId: String,
    errorCode: String,
  },
  {
    collection: 'notification_deliveries',
    versionKey: false,
    timestamps: true,
  },
);
DeliverySchema.index(
  { notificationId: 1, installationId: 1 },
  { unique: true },
);
DeliverySchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
