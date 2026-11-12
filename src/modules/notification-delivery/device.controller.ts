import {
  Body,
  Controller,
  Delete,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsUUID, Matches } from 'class-validator';
import { ApiResponseDto } from '../../common/dto/api-response.dto';
import type { UserContext } from '../authentication/domain/user-context';
import { CurrentUser } from '../authentication/presentation/decorators/current-user.decorator';
import { GatewayAuthenticationGuard } from '../authentication/presentation/guards/gateway-authentication.guard';
import { NotificationDeliveryService } from './notification-delivery.service';

export class DeviceProofDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43,128}$/)
  installationSecret: string;
}
export class RegisterDeviceDto extends DeviceProofDto {
  @IsUUID('4')
  installationId: string;

  @IsString()
  @Matches(/^[cdef][A-Za-z0-9_-]{21}$/)
  fid: string;
}

@Controller('devices')
@UseGuards(GatewayAuthenticationGuard)
export class DeviceController {
  constructor(private readonly delivery: NotificationDeliveryService) {}

  @Put()
  async register(
    @CurrentUser() user: UserContext,
    @Body() body: RegisterDeviceDto,
  ) {
    await this.delivery.register(user.userId, body);
    return new ApiResponseDto({
      result: { installationId: body.installationId },
    });
  }

  @Delete(':installationId')
  async unregister(
    @CurrentUser() user: UserContext,
    @Param('installationId') installationId: string,
    @Body() body: DeviceProofDto,
  ) {
    await this.delivery.unregister(
      user.userId,
      installationId,
      body.installationSecret,
    );
    return new ApiResponseDto({ message: 'Device unregistered' });
  }
}
