import type { HealthCheckService, MongooseHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const checks: unknown[][] = [];
  const health = {
    check: async (indicators: (() => unknown)[]) => {
      checks.push(await Promise.all(indicators.map((run) => run())));
      return { status: 'ok' };
    },
  } as unknown as HealthCheckService;
  const mongo = {
    pingCheck: async (key: string) => ({ [key]: { status: 'up' } }),
  } as unknown as MongooseHealthIndicator;
  const controller = new HealthController(health, mongo);

  it('returns pong', () => {
    expect(controller.ping()).toBe('pong');
  });

  it('checks MongoDB for readiness but no dependency for liveness', async () => {
    await controller.readiness();
    await controller.liveness();
    expect(checks).toEqual([[{ mongodb: { status: 'up' } }], []]);
  });
});
