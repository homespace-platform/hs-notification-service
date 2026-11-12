import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';
import { AdminGuard } from '../../authentication/presentation/guards/admin.guard';
import { GatewayAuthenticationGuard } from '../../authentication/presentation/guards/gateway-authentication.guard';
import { AdminBroadcastService } from '../application/admin-broadcast.service';
import { AdminBroadcastController } from './admin-broadcast.controller';

describe('AdminBroadcastController', () => {
  let app: INestApplication;
  const send = jest.fn().mockResolvedValue({ broadcastId: '4a5a7032-5ce9-4af5-b6c0-1022a38d9165', recipientCount: 2 });
  const body = { broadcastId: '4a5a7032-5ce9-4af5-b6c0-1022a38d9165', title: 'Thông báo', body: 'Nội dung', priority: 'URGENT' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminBroadcastController],
      providers: [
        GatewayAuthenticationGuard,
        AdminGuard,
        { provide: AdminBroadcastService, useValue: { send } },
        { provide: ConfigService, useValue: { getOrThrow: () => 'test-only-internal-gateway-secret-32' } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { send.mockClear(); });

  const post = () => request(app.getHttpServer()).post('/admin/broadcast')
    .set('X-Internal-Secret', 'test-only-internal-gateway-secret-32')
    .set('X-User-Id', 'actor-1')
    .set('Authorization', 'Bearer admin-token');

  it('rejects a direct request without gateway secret', async () => {
    await request(app.getHttpServer()).post('/admin/broadcast').set('X-User-Role', 'ADMIN').send(body).expect(401);
  });

  it('rejects authenticated USER', async () => {
    await post().set('X-User-Role', 'USER').send(body).expect(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('validates input and forwards only an authenticated admin request', async () => {
    await post().set('X-User-Role', 'ADMIN').send({ ...body, actionPath: '//evil.example' }).expect(400);
    await post().set('X-User-Role', 'ADMIN').send(body).expect(201);
    expect(send).toHaveBeenCalledWith(expect.objectContaining(body), 'Bearer admin-token');
  });
});
