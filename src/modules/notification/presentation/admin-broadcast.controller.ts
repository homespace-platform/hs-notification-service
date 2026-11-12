import { Body, Controller, Headers, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiResponseDto } from '../../../common/dto/api-response.dto';
import { AdminGuard } from '../../authentication/presentation/guards/admin.guard';
import { GatewayAuthenticationGuard } from '../../authentication/presentation/guards/gateway-authentication.guard';
import { AdminBroadcastService } from '../application/admin-broadcast.service';
import { AdminBroadcastDto } from './dto/admin-broadcast.dto';

@Controller('admin')
@UseGuards(GatewayAuthenticationGuard, AdminGuard)
export class AdminBroadcastController {
  constructor(private readonly service: AdminBroadcastService) {}

  @Post('broadcast')
  async broadcast(
    @Body() input: AdminBroadcastDto,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<ApiResponseDto<{ broadcastId: string; recipientCount: number }>> {
    if (!input.isValidActionPath()) throw new BadRequestException('Invalid action path');
    if (!authorization?.startsWith('Bearer ')) throw new BadRequestException('Missing bearer token');
    return new ApiResponseDto({ result: await this.service.send(input, authorization) });
  }
}
