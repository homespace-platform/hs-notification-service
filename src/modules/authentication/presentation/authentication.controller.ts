import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiResponseDto } from '../../../common/dto/api-response.dto';
import type { UserContext } from '../domain/user-context';
import { CurrentUser } from './decorators/current-user.decorator';
import { GatewayAuthenticationGuard } from './guards/gateway-authentication.guard';

@Controller('auth')
export class AuthenticationController {
  @Get('me')
  @UseGuards(GatewayAuthenticationGuard)
  me(@CurrentUser() user: UserContext): ApiResponseDto<UserContext> {
    return new ApiResponseDto({ result: user });
  }
}
