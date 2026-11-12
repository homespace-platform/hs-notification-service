import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiResponseDto } from '../../../common/dto/api-response.dto';
import type { UserContext } from '../../authentication/domain/user-context';
import { CurrentUser } from '../../authentication/presentation/decorators/current-user.decorator';
import { GatewayAuthenticationGuard } from '../../authentication/presentation/guards/gateway-authentication.guard';
import {
  NotificationService,
  type FeedPage,
  type NotificationView,
} from '../application/notification.service';
import type { PreferenceItem } from '../domain/notification.model';
import { FeedQueryDto, UpdatePreferencesDto } from './dto/notification.dto';
import { NotificationIdPipe } from './notification-id.pipe';
import { NotificationRealtimeService } from '../../notification-realtime/notification-realtime.service';

/**
 * Mounted behind the Gateway at /api/v1/notifications/** (prefix stripped by
 * the Gateway rewrite). The owner is always the trusted Gateway identity;
 * no endpoint accepts a recipient/user id from the client.
 */
@Controller()
@UseGuards(GatewayAuthenticationGuard)
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);
  constructor(
    private readonly service: NotificationService,
    private readonly realtime: NotificationRealtimeService,
  ) {}

  @Get('feed')
  async feed(
    @CurrentUser() user: UserContext,
    @Query() query: FeedQueryDto,
  ): Promise<ApiResponseDto<FeedPage>> {
    return new ApiResponseDto({
      result: await this.service.getFeed(user.userId, query),
    });
  }

  @Get('unread-count')
  async unreadCount(
    @CurrentUser() user: UserContext,
  ): Promise<ApiResponseDto<{ count: number }>> {
    return new ApiResponseDto({
      result: await this.service.getUnreadCount(user.userId),
    });
  }

  @Patch('read-all')
  async readAll(
    @CurrentUser() user: UserContext,
  ): Promise<ApiResponseDto<{ updated: number }>> {
    const result = await this.service.markAllRead(user.userId);
    await this.broadcast(user.userId, () =>
      this.realtime.emitRead(user.userId, { all: true }),
    );
    return new ApiResponseDto({ result });
  }

  @Get('preferences')
  async preferences(
    @CurrentUser() user: UserContext,
  ): Promise<ApiResponseDto<{ items: PreferenceItem[] }>> {
    return new ApiResponseDto({
      result: { items: await this.service.getPreferences(user.userId) },
    });
  }

  @Put('preferences')
  async updatePreferences(
    @CurrentUser() user: UserContext,
    @Body() body: UpdatePreferencesDto,
  ): Promise<ApiResponseDto<{ items: PreferenceItem[] }>> {
    return new ApiResponseDto({
      result: {
        items: await this.service.updatePreferences(user.userId, body.items),
      },
    });
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: UserContext,
    @Param('id', NotificationIdPipe) id: string,
  ): Promise<ApiResponseDto<NotificationView>> {
    const result = await this.service.markRead(user.userId, id);
    await this.broadcast(user.userId, () =>
      this.realtime.emitRead(user.userId, result),
    );
    return new ApiResponseDto({ result });
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: UserContext,
    @Param('id', NotificationIdPipe) id: string,
  ): Promise<ApiResponseDto<void>> {
    await this.service.delete(user.userId, id);
    await this.broadcast(user.userId, () =>
      this.realtime.emitDeleted(user.userId, id),
    );
    return new ApiResponseDto({ message: 'Notification deleted' });
  }

  private async broadcast(
    userId: string,
    emitMutation: () => void,
  ): Promise<void> {
    try {
      emitMutation();
      this.realtime.emitUnreadCount(
        userId,
        (await this.service.getUnreadCount(userId)).count,
      );
    } catch {
      this.logger.warn('Realtime mutation deferred to client feed refresh');
    }
  }
}
