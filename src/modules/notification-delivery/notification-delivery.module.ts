import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthenticationModule } from '../authentication/authentication.module';
import {
  NotificationDocument,
  NotificationSchema,
} from '../notification/infrastructure/notification.schema';
import {
  NotificationPreferenceDocument,
  NotificationPreferenceSchema,
} from '../notification/infrastructure/notification-preference.schema';
import {
  DEVICE_MODEL,
  DELIVERY_MODEL,
  DeviceSchema,
  DeliverySchema,
} from './delivery.schema';
import { DeviceController } from './device.controller';
import { FirebasePushProvider } from './firebase-push.provider';
import { NotificationDeliveryService } from './notification-delivery.service';

@Module({
  imports: [
    ConfigModule,
    AuthenticationModule,
    MongooseModule.forFeature([
      { name: DEVICE_MODEL, schema: DeviceSchema },
      { name: DELIVERY_MODEL, schema: DeliverySchema },
      { name: NotificationDocument.name, schema: NotificationSchema },
      {
        name: NotificationPreferenceDocument.name,
        schema: NotificationPreferenceSchema,
      },
    ]),
  ],
  controllers: [DeviceController],
  providers: [NotificationDeliveryService, FirebasePushProvider],
  exports: [NotificationDeliveryService],
})
export class NotificationDeliveryModule {}
