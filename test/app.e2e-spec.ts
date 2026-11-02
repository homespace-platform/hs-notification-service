import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthenticationController } from '../src/modules/authentication/presentation/authentication.controller';
import { GatewayAuthenticationGuard } from '../src/modules/authentication/presentation/guards/gateway-authentication.guard';
import { HealthController } from '../src/modules/health/presentation/health.controller';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController, AuthenticationController],
      providers: [GatewayAuthenticationGuard],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ping (GET) is public', () => {
    return request(app.getHttpServer()).get('/ping').expect(200).expect('pong');
  });

  it('/auth/me (GET) rejects a request without gateway identity', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('/auth/me (GET) returns gateway identity', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .set('X-User-Id', 'user-123')
      .set('X-User-Email', 'user@homespace.vn')
      .set('X-User-Name', 'Home Space User')
      .set('X-User-Role', 'USER')
      .set('X-User-Authorities', 'NOTIFICATION_READ')
      .expect(200)
      .expect({
        code: 1000,
        result: {
          userId: 'user-123',
          email: 'user@homespace.vn',
          name: 'Home Space User',
          role: 'USER',
          authorities: ['NOTIFICATION_READ'],
        },
      });
  });

  it('/auth/me (GET) decodes a UTF-8 display name from the gateway', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .set('X-User-Id', 'user-123')
      .set('X-User-Name-B64', Buffer.from('Tuấn Đào', 'utf8').toString('base64'))
      .expect(200)
      .expect((response) => {
        expect(response.body.result.name).toBe('Tuấn Đào');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
