import { jest } from '@jest/globals';
import type { Namespace, Socket } from 'socket.io';
import { NotificationRealtimeGateway } from './notification-realtime.gateway';
import { NotificationRealtimeService } from './notification-realtime.service';
import { NotificationSocketAuthService } from './notification-socket-auth.service';

describe('NotificationRealtimeGateway', () => {
  it('joins only the JWT subject room across tabs/reconnects and isolates emissions', async () => {
    let middleware!: (socket: Socket, next: (error?: Error) => void) => void;
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const server = {
      use: (fn: typeof middleware) => {
        middleware = fn;
      },
      to,
    };
    const auth = {
      authenticate: jest.fn(async (_origin: unknown, token: unknown) => {
        if (token !== 'valid') throw new Error('Unauthenticated');
        return { userId: 'alice', expiresAt: Date.now() + 60000 };
      }),
    };
    const realtime = new NotificationRealtimeService();
    const gateway = new NotificationRealtimeGateway(
      auth as unknown as NotificationSocketAuthService,
      realtime,
    );
    gateway.afterInit(server as unknown as Namespace);
    for (let tab = 0; tab < 3; tab++) {
      const join = jest.fn(async () => undefined);
      const socket = {
        handshake: {
          headers: { origin: 'https://app.example' },
          auth: { token: 'valid', userId: 'bob' },
        },
        join,
        once: jest.fn(),
        disconnect: jest.fn(),
      };
      await new Promise<void>((resolve, reject) =>
        middleware(socket as unknown as Socket, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      expect(join).toHaveBeenCalledWith('user:alice');
      expect(join).toHaveBeenCalledTimes(1);
    }
    realtime.emitDeleted('alice', 'notification-id');
    expect(to).toHaveBeenCalledWith('user:alice');
    expect(emit).toHaveBeenCalledWith('notification:deleted', {
      id: 'notification-id',
    });
    const join = jest.fn();
    await new Promise<void>((resolve) =>
      middleware(
        {
          handshake: { headers: {}, auth: { userId: 'alice' } },
          join,
        } as unknown as Socket,
        (error) => {
          expect(error?.message).toBe('Unauthenticated');
          resolve();
        },
      ),
    );
    expect(join).not.toHaveBeenCalled();
    gateway.onModuleDestroy();
  });
});
