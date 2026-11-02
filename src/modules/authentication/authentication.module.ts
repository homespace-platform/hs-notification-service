import { Module } from '@nestjs/common';
import { AuthenticationController } from './presentation/authentication.controller';
import { GatewayAuthenticationGuard } from './presentation/guards/gateway-authentication.guard';
import { AdminGuard } from './presentation/guards/admin.guard';

@Module({
  controllers: [AuthenticationController],
  providers: [GatewayAuthenticationGuard, AdminGuard],
  exports: [GatewayAuthenticationGuard, AdminGuard],
})
export class AuthenticationModule {}
