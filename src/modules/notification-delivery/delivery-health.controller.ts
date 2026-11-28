import { Controller, Get, Header, UseGuards, Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { GatewayAuthenticationGuard } from '../authentication/presentation/guards/gateway-authentication.guard';
import { AdminGuard } from '../authentication/presentation/guards/admin.guard';
import type { UserContext } from '../authentication/domain/user-context';
import { ApiResponseDto } from '../../common/dto/api-response.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.constant';
import { DeliveryHealthService } from './delivery-health.service';

@Injectable()
export class SystemHealthViewGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: UserContext }>().user;
    if (!user?.authorities.includes('SYSTEM_HEALTH_VIEW')) throw new AppException(ErrorCode.UNAUTHORIZED);
    return true;
  }
}

@Controller('admin/delivery-health')
@UseGuards(GatewayAuthenticationGuard, AdminGuard, SystemHealthViewGuard)
export class DeliveryHealthController {
  constructor(private readonly health: DeliveryHealthService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async summary() {
    return new ApiResponseDto({ result: await this.health.summary() });
  }
}
