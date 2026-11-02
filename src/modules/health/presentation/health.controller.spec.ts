import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns pong', () => {
    expect(new HealthController().ping()).toBe('pong');
  });
});
