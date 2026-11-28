import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MongooseHealthIndicator,
} from '@nestjs/terminus';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongo: MongooseHealthIndicator,
  ) {}

  @Get('ping')
  ping(): string {
    return 'pong';
  }

  /** Public (like Spring actuator): reports only up/down per dependency; HTTP 503 when one is down. */
  @Get(['health', 'health/readiness'])
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.mongo.pingCheck('mongodb', { timeout: 3000 }),
    ]);
  }

  @Get('health/liveness')
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }
}
