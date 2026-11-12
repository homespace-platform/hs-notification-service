import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationRealtimeGateway } from './notification-realtime.gateway';
import { NotificationRealtimeService } from './notification-realtime.service';
import { NotificationSocketAuthService } from './notification-socket-auth.service';

@Module({
  imports: [ConfigModule],
  providers: [
    NotificationRealtimeGateway,
    NotificationRealtimeService,
    NotificationSocketAuthService,
  ],
  exports: [NotificationRealtimeService],
})
export class NotificationRealtimeModule {}
