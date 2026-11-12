import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { AdminBroadcastService } from './admin-broadcast.service';
import { NotificationService } from './notification.service';
import { InMemoryNotificationRepository, InMemoryPreferenceRepository } from '../testing/in-memory-notification.repository';
import type { AdminBroadcastDto } from '../presentation/dto/admin-broadcast.dto';

const input = {
  broadcastId: '4a5a7032-5ce9-4af5-b6c0-1022a38d9165',
  title: 'Thông báo khẩn',
  body: 'Vui lòng kiểm tra hệ thống.',
  priority: 'URGENT' as const,
} as AdminBroadcastDto;

function page(users: unknown[], hasMore = false): Response {
  return new Response(JSON.stringify({ result: { result: users, hasMore } }), { status: 200 });
}

describe('AdminBroadcastService', () => {
  const originalFetch = global.fetch;
  let repo: InMemoryNotificationRepository;
  let service: AdminBroadcastService;

  beforeEach(() => {
    repo = new InMemoryNotificationRepository();
    const notifications = new NotificationService(repo, new InMemoryPreferenceRepository());
    service = new AdminBroadcastService(
      { getOrThrow: () => 'http://localhost:8080/api/v1/admin/users' } as unknown as ConfigService,
      notifications,
    );
  });

  afterEach(() => { global.fetch = originalFetch; });

  it('reads all pages and creates only active USER notifications', async () => {
    const requests: string[] = [];
    global.fetch = jest.fn(async (url: URL, options: RequestInit) => {
      requests.push(url.toString());
      expect(options.headers).toEqual({ Authorization: 'Bearer admin-token' });
      return requests.length === 1
        ? page([{ id: 'user-1', role: 'USER', active: true }, { id: 'admin-1', role: 'ADMIN', active: true }], true)
        : page([{ id: 'user-2', role: 'USER', active: false }, { id: 'user-3', role: 'USER', active: true }]);
    }) as typeof fetch;

    await expect(service.send(input, 'Bearer admin-token')).resolves.toEqual({ broadcastId: input.broadcastId, recipientCount: 2 });
    expect(repo.rows.map((row) => row.recipientId)).toEqual(['user-1', 'user-3']);
    expect(repo.rows.every((row) => row.category === 'SYSTEM' && row.priority === 'URGENT')).toBe(true);
    expect(requests[0]).toContain('page=0');
    expect(requests[1]).toContain('page=1');
  });

  it('retries the same broadcast ID without duplicate notifications', async () => {
    global.fetch = jest.fn(async () => page([{ id: 'user-1', role: 'USER', active: true }])) as typeof fetch;
    await service.send(input, 'Bearer admin-token');
    await service.send(input, 'Bearer admin-token');
    expect(repo.rows).toHaveLength(1);
    await expect(service.send({ ...input, title: 'Changed' }, 'Bearer admin-token')).rejects.toThrow('Broadcast ID already used');
  });

  it('fails closed on an invalid directory response', async () => {
    global.fetch = jest.fn(async () => page([{ id: 'user-1', role: 'USER' }])) as typeof fetch;
    await expect(service.send(input, 'Bearer admin-token')).rejects.toThrow('User directory response invalid');
    expect(repo.rows).toHaveLength(0);
  });
});
