import { type OnModuleDestroy } from '@nestjs/common';
import { OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { Namespace } from 'socket.io';
import { NotificationRealtimeService } from './notification-realtime.service';
import { NotificationSocketAuthService } from './notification-socket-auth.service';

@WebSocketGateway({ namespace: '/notifications', transports: ['websocket'] })
export class NotificationRealtimeGateway
  implements OnGatewayInit, OnModuleDestroy
{
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly auth: NotificationSocketAuthService,
    private readonly realtime: NotificationRealtimeService,
  ) {}

  afterInit(server: Namespace): void {
    this.realtime.attach(server);
    server.use((socket, next) => {
      void this.auth
        .authenticate(
          socket.handshake.headers.origin,
          socket.handshake.auth?.token,
        )
        .then(async ({ userId, expiresAt }) => {
          await socket.join(`user:${userId}`);
          // Reconnect with a refreshed token; an expired connection must stop receiving private data.
          const timer = setTimeout(
            () => socket.disconnect(true),
            Math.max(0, Math.min(expiresAt - Date.now(), 2147483647)),
          );
          timer.unref();
          this.timers.add(timer);
          socket.once('disconnect', () => {
            clearTimeout(timer);
            this.timers.delete(timer);
          });
          next();
        })
        .catch(() => next(new Error('Unauthenticated')));
    });
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
