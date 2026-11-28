import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EurekaModule } from '../../infrastructure/discovery/eureka.module';
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
import { EmailDeliveryService } from './email-delivery.service';
import { EMAIL_DELIVERY_MODEL, EmailDeliverySchema, EmailOutbox, MongoEmailOutbox } from './email-outbox';
import { CoreDocumentClient, DocumentClient } from './core-document.client';
import { EmailProvider } from './email.provider';
import { CoreUserEmailDirectory, UserEmailDirectory } from './user-email.directory';
import { FirebasePushProvider } from './firebase-push.provider';
import { NotificationDeliveryService } from './notification-delivery.service';

@Module({
  imports: [
    EurekaModule,
    ConfigModule,
    AuthenticationModule,
    MongooseModule.forFeature([
      { name: DEVICE_MODEL, schema: DeviceSchema },
      { name: DELIVERY_MODEL, schema: DeliverySchema },
      { name: EMAIL_DELIVERY_MODEL, schema: EmailDeliverySchema },
      { name: NotificationDocument.name, schema: NotificationSchema },
      {
        name: NotificationPreferenceDocument.name,
        schema: NotificationPreferenceSchema,
      },
    ]),
  ],
  controllers: [DeviceController],
  providers: [
    NotificationDeliveryService,
    FirebasePushProvider,
    EmailProvider,
    EmailDeliveryService,
    { provide: EmailOutbox, useClass: MongoEmailOutbox },
    { provide: UserEmailDirectory, useClass: CoreUserEmailDirectory },
    { provide: DocumentClient, useClass: CoreDocumentClient },
  ],
  exports: [NotificationDeliveryService, EmailProvider, EmailDeliveryService],
})
export class NotificationDeliveryModule {}
