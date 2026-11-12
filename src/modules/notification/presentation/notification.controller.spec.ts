import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';
import { GatewayAuthenticationGuard } from '../../authentication/presentation/guards/gateway-authentication.guard';
import { HealthController } from '../../health/presentation/health.controller';
import { NotificationService } from '../application/notification.service';
import {
  NotificationPreferenceRepository,
  NotificationRepository,
} from '../domain/notification.repository';
import {
  InMemoryNotificationRepository,
  InMemoryPreferenceRepository,
} from '../testing/in-memory-notification.repository';
import { NotificationController } from './notification.controller';
import { NotificationRealtimeService } from '../../notification-realtime/notification-realtime.service';

const SECRET = 'test-only-internal-gateway-secret-32';
const ALICE = 'alice-keycloak-id';
const BOB = 'bob-keycloak-id';
const T0 = Date.parse('2026-01-01T00:00:00.000Z');

describe('NotificationController (HTTP)', () => {
  let app: INestApplication;
  let service: NotificationService;
  let repo: InMemoryNotificationRepository;

  const as = (userId: string) => ({
    'X-Internal-Secret': SECRET,
    'X-User-Id': userId,
  });
  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    repo = new InMemoryNotificationRepository();
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationController, HealthController],
      providers: [
        GatewayAuthenticationGuard,
        NotificationService,
        NotificationRealtimeService,
        { provide: NotificationRepository, useValue: repo },
        {
          provide: NotificationPreferenceRepository,
          useValue: new InMemoryPreferenceRepository(),
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => SECRET },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    service = app.get(NotificationService);
  });

  afterEach(async () => {
    await app.close();
  });

  async function seed(recipientId: string, count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const { notification } = await service.create({
        recipientId,
        sourceEventId: `${recipientId}-${i}`,
        category: 'PAYMENT',
        type: 'PAYMENT_RECEIVED',
        title: `n${i}`,
        body: 'body',
        priority: 'NORMAL',
        createdAt: new Date(T0 + i * 1000),
      });
      ids.push(notification.id);
    }
    return ids;
  }

  describe('trust boundary', () => {
    const routes: Array<[string, string]> = [
      ['get', '/feed'],
      ['get', '/unread-count'],
      ['patch', '/read-all'],
      ['get', '/preferences'],
      ['put', '/preferences'],
      ['patch', `/${'a'.repeat(24)}/read`],
      ['delete', `/${'a'.repeat(24)}`],
    ];

    it.each(routes)(
      'rejects a spoofed X-User-Id without the internal secret: %s %s',
      async (method, path) => {
        await seed(ALICE, 1);
        const res = await (
          http() as never as Record<string, (p: string) => request.Test>
        )
          [method](path)
          .set('X-User-Id', ALICE)
          .send(method === 'put' ? { items: [] } : undefined);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ code: 1002, message: 'Unauthenticated' });
      },
    );

    it('rejects a wrong internal secret even with a valid-looking user', async () => {
      await seed(ALICE, 1);
      await http()
        .get('/feed')
        .set('X-Internal-Secret', 'wrong-secret-wrong-secret-wrong-secret')
        .set('X-User-Id', ALICE)
        .expect(401);
    });

    it('keeps /ping public', async () => {
      await http().get('/ping').expect(200).expect('pong');
    });
  });

  it('broadcasts persisted mutations only to the authenticated owner', async () => {
    const [id] = await seed(ALICE, 2);
    const realtime = app.get(NotificationRealtimeService);
    const read = jest.spyOn(realtime, 'emitRead');
    const deleted = jest.spyOn(realtime, 'emitDeleted');
    const count = jest.spyOn(realtime, 'emitUnreadCount');
    await http().patch(`/${id}/read`).set(as(BOB)).expect(404);
    await http().delete(`/${id}`).set(as(BOB)).expect(404);
    expect(read).not.toHaveBeenCalled();
    expect(deleted).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    await http().patch(`/${id}/read`).set(as(ALICE)).expect(200);
    expect(read).toHaveBeenLastCalledWith(
      ALICE,
      expect.objectContaining({ id }),
    );
    expect(count).toHaveBeenLastCalledWith(ALICE, 1);
    await http().patch('/read-all').set(as(ALICE)).expect(200);
    expect(read).toHaveBeenLastCalledWith(ALICE, { all: true });
    expect(count).toHaveBeenLastCalledWith(ALICE, 0);
    await http().delete(`/${id}`).set(as(ALICE)).expect(200);
    expect(deleted).toHaveBeenLastCalledWith(ALICE, id);
  });

  it.each(['count', 'emit'])(
    'preserves successful REST mutations when realtime %s fails',
    async (failure) => {
      const [id, deletedId] = await seed(ALICE, 2);
      const realtime = app.get(NotificationRealtimeService);
      if (failure === 'count') {
        jest
          .spyOn(service, 'getUnreadCount')
          .mockRejectedValue(new Error('private diagnostic'));
      } else {
        jest.spyOn(realtime, 'emitRead').mockImplementation(() => {
          throw new Error('private diagnostic');
        });
        jest.spyOn(realtime, 'emitDeleted').mockImplementation(() => {
          throw new Error('private diagnostic');
        });
      }
      await http().patch(`/${id}/read`).set(as(ALICE)).expect(200);
      expect(repo.rows.find((row) => row.id === id)?.readAt).toBeInstanceOf(
        Date,
      );
      await http().patch('/read-all').set(as(ALICE)).expect(200);
      expect(repo.rows.every((row) => row.readAt instanceof Date)).toBe(true);
      await http().delete(`/${deletedId}`).set(as(ALICE)).expect(200);
      expect(
        repo.rows.find((row) => row.id === deletedId)?.deletedAt,
      ).toBeInstanceOf(Date);
    },
  );

  describe('endpoints', () => {
    it('GET /feed returns the caller’s items with cursor pagination', async () => {
      await seed(ALICE, 3);
      await seed(BOB, 2);

      const page1 = await http()
        .get('/feed?limit=2')
        .set(as(ALICE))
        .expect(200);
      expect(page1.body.code).toBe(1000);
      expect(
        page1.body.result.items.map((n: { title: string }) => n.title),
      ).toEqual(['n2', 'n1']);
      expect(page1.body.result.hasMore).toBe(true);
      expect(JSON.stringify(page1.body)).not.toContain(ALICE);

      const page2 = await http()
        .get('/feed')
        .query({ limit: 2, cursor: page1.body.result.nextCursor })
        .set(as(ALICE))
        .expect(200);
      expect(page2.body.result.items).toHaveLength(1);
      expect(page2.body.result.nextCursor).toBeNull();
    });

    it('GET /feed ignores a client-supplied recipientId (rejected by validation)', async () => {
      await seed(BOB, 1);
      await http().get(`/feed?recipientId=${BOB}`).set(as(ALICE)).expect(400);
      await http()
        .get('/feed')
        .set({ ...as(ALICE), 'X-Recipient-Id': BOB })
        .expect(200)
        .expect((res) => expect(res.body.result.items).toHaveLength(0));
    });

    it('GET /feed validates query params', async () => {
      await http().get('/feed?limit=0').set(as(ALICE)).expect(400);
      await http().get('/feed?limit=51').set(as(ALICE)).expect(400);
      await http().get('/feed?category=NOPE').set(as(ALICE)).expect(400);
      await http().get('/feed?unreadOnly=maybe').set(as(ALICE)).expect(400);
      await http().get('/feed?cursor=garbage').set(as(ALICE)).expect(400);
    });

    it('GET /feed supports category and unreadOnly', async () => {
      const [first] = await seed(ALICE, 2);
      await http().patch(`/${first}/read`).set(as(ALICE)).expect(200);
      const res = await http()
        .get('/feed?unreadOnly=true&category=PAYMENT')
        .set(as(ALICE))
        .expect(200);
      expect(res.body.result.items).toHaveLength(1);
    });

    it('GET /unread-count is per user', async () => {
      await seed(ALICE, 3);
      await seed(BOB, 1);
      const res = await http().get('/unread-count').set(as(ALICE)).expect(200);
      expect(res.body.result).toEqual({ count: 3 });
    });

    it('PATCH /:id/read is owner-only and returns 404 for others', async () => {
      const [id] = await seed(ALICE, 1);
      await http().patch(`/${id}/read`).set(as(BOB)).expect(404);
      const ok = await http().patch(`/${id}/read`).set(as(ALICE)).expect(200);
      expect(ok.body.result.readAt).toEqual(expect.any(String));
      await http().patch('/not-an-id/read').set(as(ALICE)).expect(404);
    });

    it('PATCH /read-all only touches the caller', async () => {
      await seed(ALICE, 2);
      await seed(BOB, 2);
      const res = await http().patch('/read-all').set(as(ALICE)).expect(200);
      expect(res.body.result).toEqual({ updated: 2 });
      const bob = await http().get('/unread-count').set(as(BOB)).expect(200);
      expect(bob.body.result.count).toBe(2);
    });

    it('DELETE /:id soft-deletes for the owner only', async () => {
      const [id] = await seed(ALICE, 1);
      await http().delete(`/${id}`).set(as(BOB)).expect(404);
      await http().delete(`/${id}`).set(as(ALICE)).expect(200);
      expect(repo.rows[0].deletedAt).toBeInstanceOf(Date);
      await http().delete(`/${id}`).set(as(ALICE)).expect(404);
      const feed = await http().get('/feed').set(as(ALICE)).expect(200);
      expect(feed.body.result.items).toHaveLength(0);
    });

    it('GET/PUT /preferences round-trip and validate input', async () => {
      const initial = await http()
        .get('/preferences')
        .set(as(ALICE))
        .expect(200);
      expect(
        initial.body.result.items.every((i: { push: boolean }) => i.push),
      ).toBe(true);

      const put = await http()
        .put('/preferences')
        .set(as(ALICE))
        .send({ items: [{ category: 'CHAT', push: false, email: false }] })
        .expect(200);
      expect(
        put.body.result.items.find(
          (i: { category: string }) => i.category === 'CHAT',
        ),
      ).toEqual({ category: 'CHAT', push: false, email: false });

      const bob = await http().get('/preferences').set(as(BOB)).expect(200);
      expect(
        bob.body.result.items.find(
          (i: { category: string }) => i.category === 'CHAT',
        ).push,
      ).toBe(true);

      for (const bad of [
        {},
        { items: [{ category: 'NOPE', push: true, email: true }] },
        { items: [{ category: 'CHAT', push: 'yes', email: true }] },
        { items: [{ category: 'CHAT', push: true, email: true, extra: 1 }] },
        { items: [], userId: BOB },
        {
          items: [
            { category: 'CHAT', push: true, email: true },
            { category: 'CHAT', push: false, email: true },
          ],
        },
      ]) {
        await http().put('/preferences').set(as(ALICE)).send(bad).expect(400);
      }
    });

    it('preference changes never remove stored in-app notifications', async () => {
      await http()
        .put('/preferences')
        .set(as(ALICE))
        .send({ items: [{ category: 'PAYMENT', push: false, email: false }] })
        .expect(200);
      await seed(ALICE, 1);
      const feed = await http().get('/feed').set(as(ALICE)).expect(200);
      expect(feed.body.result.items).toHaveLength(1);
    });

    it('does not expose any public create/test-send endpoint', async () => {
      await http().post('/feed').set(as(ALICE)).send({}).expect(404);
      await http().post('/send').set(as(ALICE)).send({}).expect(404);
      await http().post('/').set(as(ALICE)).send({}).expect(404);
    });
  });
});
