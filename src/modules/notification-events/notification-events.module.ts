import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationModule } from '../notification/notification.module';
import { NotificationEventsConsumer } from './notification-events.consumer';

@Module({
  imports: [ConfigModule, NotificationModule],
  providers: [NotificationEventsConsumer],
  exports: [NotificationEventsConsumer],
})
export class NotificationEventsModule {}
