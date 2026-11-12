import 'reflect-metadata';
import { validateEnvironment } from './environment.validation';

const SECRET = 'test-only-internal-gateway-secret-32';
const MONGODB_URI = 'mongodb://database.example/homespace_notification';

describe('validateEnvironment', () => {
  const base = { MONGODB_URI, GATEWAY_INTERNAL_SECRET: SECRET };

  it('parses false feature flags without enabling external providers', () => {
    const result = validateEnvironment({ ...base, KAFKA_ENABLED: 'false', PUSH_ENABLED: 'false', NOTIFICATION_REALTIME_ENABLED: 'false' });
    expect(result.KAFKA_ENABLED).toBe(false);
    expect(result.PUSH_ENABLED).toBe(false);
    expect(result.NOTIFICATION_REALTIME_ENABLED).toBe(false);
  });

  it('fails closed for an enabled feature missing configuration', () => {
    for (const flag of ['KAFKA_ENABLED', 'PUSH_ENABLED', 'NOTIFICATION_REALTIME_ENABLED']) {
      expect(() => validateEnvironment({ ...base, [flag]: 'true' })).toThrow();
    }
    expect(() => validateEnvironment({ ...base, KAFKA_ENABLED: 'yes' })).toThrow();
  });

  it('requires separate Kafka topics and bounded integer retries', () => {
    const kafka = { ...base, KAFKA_ENABLED: 'true', KAFKA_BROKERS: 'localhost:9092', KAFKA_CLIENT_ID: 'test', KAFKA_GROUP_ID: 'test', KAFKA_EVENTS_TOPIC: 'events', KAFKA_DLT_TOPIC: 'dlt', KAFKA_RETRY_ATTEMPTS: '3', KAFKA_RETRY_DELAY_MS: '100' };
    expect(validateEnvironment(kafka).KAFKA_RETRY_ATTEMPTS).toBe(3);
    expect(() => validateEnvironment({ ...kafka, KAFKA_RETRY_ATTEMPTS: '1.5' })).toThrow();
    expect(() => validateEnvironment({ ...kafka, KAFKA_DLT_TOPIC: 'events' })).toThrow();
  });
  it('fails fast when MONGODB_URI is missing', () => {
    expect(() =>
      validateEnvironment({ GATEWAY_INTERNAL_SECRET: SECRET }),
    ).toThrow('Invalid environment configuration');
  });

  it('converts the dotenv port value to a number', () => {
    const config = validateEnvironment({
      PORT: '8085',
      MONGODB_URI,
      GATEWAY_INTERNAL_SECRET: SECRET,
    });

    expect(config.PORT).toBe(8085);
    expect(config.SERVICE_NAME).toBe('hs-notification-service');
  });

  it('requires a gateway internal secret with no default', () => {
    expect(() => validateEnvironment({ MONGODB_URI })).toThrow(
      'Invalid environment configuration',
    );
    expect(() =>
      validateEnvironment({ MONGODB_URI, GATEWAY_INTERNAL_SECRET: '' }),
    ).toThrow('Invalid environment configuration');
  });

  it('rejects a short gateway internal secret without leaking its value', () => {
    const shortSecret = 'short-sensitive-secret';
    let caught: Error | undefined;
    try {
      validateEnvironment({ MONGODB_URI, GATEWAY_INTERNAL_SECRET: shortSecret });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.message).toContain('Invalid environment configuration');
    expect(caught?.message).not.toContain(shortSecret);
  });
});
