import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import type { NotificationView } from '../notification/application/notification.service';

@Injectable()
export class NotificationRealtimeService {
  private server?: Namespace;

  attach(server: Namespace): void {
    this.server = server;
  }

  emitNew(
    recipientId: string,
    notification: NotificationView,
    popupAllowed = true,
  ): void {
    this.emit(recipientId, 'notification:new', { ...notification, popupAllowed });
  }

  emitRead(
    recipientId: string,
    notification: NotificationView | { all: true },
  ): void {
    this.emit(recipientId, 'notification:read', notification);
  }

  emitDeleted(recipientId: string, id: string): void {
    this.emit(recipientId, 'notification:deleted', { id });
  }

  emitUnreadCount(recipientId: string, count: number): void {
    this.emit(recipientId, 'notification:unread-count', { count });
  }

  emitChatAlert(
    recipientId: string,
    eventId: string,
    conversationId: string,
    messageId: string,
  ): void {
    this.emit(recipientId, 'chat:alert', { eventId, conversationId, messageId });
  }

  private emit(recipientId: string, event: string, payload: unknown): void {
    // shortcut: rooms are local to one instance; add a shared adapter before scaling replicas.
    this.server?.to(`user:${recipientId}`).emit(event, payload);
  }
}
