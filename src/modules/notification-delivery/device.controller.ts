import {
  Body,
  Controller,
  Delete,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { DEVICE_PLATFORMS, type DevicePlatform } from './delivery.schema';
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
const WEB_FID = /^[cdef][A-Za-z0-9_-]{21}$/;
const NATIVE_TOKEN = /^[A-Za-z0-9_:.-]{60,4096}$/;

@ValidatorConstraint({ name: 'pushAddressMatchesPlatform' })
class PushAddressMatchesPlatform implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const platform = (args.object as RegisterDeviceDto).platform ?? 'web';
    return (
      typeof value === 'string' &&
      (platform === 'web' ? WEB_FID : NATIVE_TOKEN).test(value)
    );
  }
  defaultMessage(): string {
    return 'fid does not match the platform push address format';
  }
}

export class RegisterDeviceDto extends DeviceProofDto {
  @IsUUID('4')
  installationId: string;

  @IsOptional()
  @IsIn(DEVICE_PLATFORMS)
  platform?: DevicePlatform;

  /** Push address for `platform`: web FID (default) or native FCM token. */
  @IsString()
  @Validate(PushAddressMatchesPlatform)
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
