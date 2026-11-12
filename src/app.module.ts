import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { validateEnvironment } from './config/environment.validation';
import { EurekaModule } from './infrastructure/discovery/eureka.module';
import { AuthenticationModule } from './modules/authentication/authentication.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationModule } from './modules/notification/notification.module';
import { NotificationEventsModule } from './modules/notification-events/notification-events.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.dev', '.env'],
      validate: validateEnvironment,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    EurekaModule,
    HealthModule,
    AuthenticationModule,
    NotificationModule,
    NotificationEventsModule,
  ],
})
export class AppModule {}
