import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from './notification.service';
import type { AdminBroadcastDto } from '../presentation/dto/admin-broadcast.dto';

type DirectoryUser = { id: string; role: string; active: boolean };

@Injectable()
export class AdminBroadcastService {
  constructor(
    private readonly config: ConfigService,
    private readonly notifications: NotificationService,
  ) {}

  async send(input: AdminBroadcastDto, authorization: string): Promise<{ broadcastId: string; recipientCount: number }> {
    const directoryUrl = this.config.getOrThrow<string>('USER_DIRECTORY_URL');
    let recipientCount = 0;
    let page = 0;
    for (;;) {
      const url = new URL(directoryUrl);
      url.searchParams.set('page', String(page));
      url.searchParams.set('size', '100');
      url.searchParams.set('sort', 'id,asc');
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        throw new ServiceUnavailableException('User directory unavailable; retry the same broadcast ID');
      }
      if (!response.ok) throw new ServiceUnavailableException('User directory unavailable; retry the same broadcast ID');
      const payload: unknown = await response.json().catch(() => null);
      const pageResult = this.parsePage(payload);
      for (const user of pageResult.users) {
        if (user.role !== 'USER' || user.active !== true) continue;
        const { notification } = await this.notifications.create({
          recipientId: user.id,
          sourceEventId: `admin_${input.broadcastId}`,
          category: 'SYSTEM',
          type: 'PLATFORM_ANNOUNCEMENT',
          title: input.title.trim(),
          body: input.body.trim(),
          priority: input.priority,
          actionPath: input.actionPath ?? '/notifications',
        });
        if (notification.title !== input.title.trim() || notification.body !== input.body.trim() || notification.priority !== input.priority || notification.actionPath !== (input.actionPath ?? '/notifications')) {
          throw new ConflictException('Broadcast ID already used with different content');
        }
        recipientCount++;
      }
      if (!pageResult.hasMore) break;
      page++;
      if (page >= 1000) throw new ServiceUnavailableException('User directory page limit reached');
    }
    return { broadcastId: input.broadcastId, recipientCount };
  }

  private parsePage(payload: unknown): { users: DirectoryUser[]; hasMore: boolean } {
    const outer = payload as { result?: { result?: unknown; hasMore?: unknown } } | null;
    const page = outer?.result;
    if (!page || !Array.isArray(page.result) || typeof page.hasMore !== 'boolean') {
      throw new ServiceUnavailableException('User directory response invalid');
    }
    const users: DirectoryUser[] = [];
    for (const row of page.result as unknown[]) {
      if (typeof row !== 'object' || row === null) throw new ServiceUnavailableException('User directory response invalid');
      const user = row as Record<string, unknown>;
      if (typeof user.id !== 'string' || typeof user.role !== 'string' || typeof user.active !== 'boolean') {
        throw new ServiceUnavailableException('User directory response invalid');
      }
      users.push(user as DirectoryUser);
    }
    return { users, hasMore: page.hasMore };
  }
}
