import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthenticationModule } from '../authentication/authentication.module';
import { NotificationService } from './application/notification.service';
import { AdminBroadcastService } from './application/admin-broadcast.service';
import {
  NotificationPreferenceRepository,
  NotificationRepository,
} from './domain/notification.repository';
import { MongoNotificationPreferenceRepository } from './infrastructure/mongo-notification-preference.repository';
import { MongoNotificationRepository } from './infrastructure/mongo-notification.repository';
import {
  NotificationPreferenceDocument,
  NotificationPreferenceSchema,
} from './infrastructure/notification-preference.schema';
import {
  NotificationDocument,
  NotificationSchema,
} from './infrastructure/notification.schema';
import { NotificationController } from './presentation/notification.controller';
import { AdminBroadcastController } from './presentation/admin-broadcast.controller';
import { NotificationDeliveryModule } from '../notification-delivery/notification-delivery.module';
import { NotificationRealtimeModule } from '../notification-realtime/notification-realtime.module';

@Module({
  imports: [
    AuthenticationModule,
    NotificationDeliveryModule,
    NotificationRealtimeModule,
    MongooseModule.forFeature([
      { name: NotificationDocument.name, schema: NotificationSchema },
      {
        name: NotificationPreferenceDocument.name,
        schema: NotificationPreferenceSchema,
      },
    ]),
  ],
  controllers: [NotificationController, AdminBroadcastController],
  providers: [
    NotificationService,
    AdminBroadcastService,
    { provide: NotificationRepository, useClass: MongoNotificationRepository },
    {
      provide: NotificationPreferenceRepository,
      useClass: MongoNotificationPreferenceRepository,
    },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
