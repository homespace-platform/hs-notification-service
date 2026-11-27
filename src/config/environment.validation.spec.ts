import 'reflect-metadata';
import { validateEnvironment } from './environment.validation';

const SECRET = 'test-only-internal-gateway-secret-32';
const MONGODB_URI = 'mongodb://database.example/homespace_notification';

describe('validateEnvironment', () => {
  const base = {
    MONGODB_URI, GATEWAY_INTERNAL_SECRET: SECRET,
    KEYCLOAK_ISSUER_URL: 'http://localhost:9000/realms/homespace-platform',
    KEYCLOAK_AUDIENCE: 'notifications',
    NOTIFICATION_REALTIME_ORIGINS: 'http://localhost:3000',
  };

  it('parses false feature flags without enabling external providers', () => {
    const result = validateEnvironment({ ...base, KAFKA_ENABLED: 'false', PUSH_ENABLED: 'false' });
    expect(result.KAFKA_ENABLED).toBe(false);
    expect(result.PUSH_ENABLED).toBe(false);
  });

  it('fails closed for an enabled feature missing configuration', () => {
    for (const flag of ['KAFKA_ENABLED', 'PUSH_ENABLED']) {
      expect(() => validateEnvironment({ ...base, [flag]: 'true' })).toThrow();
    }
    expect(() => validateEnvironment({ ...base, KAFKA_ENABLED: 'yes' })).toThrow();
  });

  it('keeps email optional and requires the sender once a Resend key is set', () => {
    expect(validateEnvironment(base).MAIL_RESEND_API_KEY).toBe('');
    expect(validateEnvironment({ ...base, MAIL_RESEND_API_KEY: '  ' }).MAIL_RESEND_API_KEY).toBe('');
    const mail = { ...base, MAIL_RESEND_API_KEY: 're_x', MAIL_FROM_ADDRESS: 'no-reply@homespace.vn', MAIL_FROM_NAME: 'HomeSpace', MAIL_APP_BASE_URL: 'https://homespace.id.vn/' };
    expect(validateEnvironment(mail).MAIL_FROM_NAME).toBe('HomeSpace');
    expect(validateEnvironment(mail).MAIL_APP_BASE_URL).toBe('https://homespace.id.vn');
    expect(() => validateEnvironment({ ...mail, MAIL_APP_BASE_URL: '' })).toThrow();
    expect(() => validateEnvironment({ ...mail, MAIL_FROM_ADDRESS: '' })).toThrow();
    expect(() => validateEnvironment({ ...mail, MAIL_FROM_NAME: '' })).toThrow();
    expect(() => validateEnvironment({ ...mail, MAIL_FROM_ADDRESS: 'nope' })).toThrow('Invalid MAIL_FROM_ADDRESS');
  });

  it('requires separate Kafka topics and bounded integer retries', () => {
    const kafka = { ...base, KAFKA_ENABLED: 'true', KAFKA_BROKERS: 'localhost:9092', KAFKA_CLIENT_ID: 'test', KAFKA_GROUP_ID: 'test', KAFKA_EVENTS_TOPIC: 'events', KAFKA_DLT_TOPIC: 'dlt', KAFKA_RETRY_ATTEMPTS: '3', KAFKA_RETRY_DELAY_MS: '100' };
    expect(validateEnvironment(kafka).KAFKA_RETRY_ATTEMPTS).toBe(3);
    expect(() => validateEnvironment({ ...kafka, KAFKA_RETRY_ATTEMPTS: '1.5' })).toThrow();
    expect(() => validateEnvironment({ ...kafka, KAFKA_DLT_TOPIC: 'events' })).toThrow();
  });
  it('requires realtime authentication and exact browser origins on every startup', () => {
    for (const name of ['KEYCLOAK_ISSUER_URL', 'KEYCLOAK_AUDIENCE', 'NOTIFICATION_REALTIME_ORIGINS']) {
      expect(() => validateEnvironment({ ...base, [name]: '' })).toThrow();
    }
    expect(() => validateEnvironment({ ...base, NOTIFICATION_REALTIME_ORIGINS: '*' })).toThrow();
  });
  it('fails fast when MONGODB_URI is missing', () => {
    expect(() =>
      validateEnvironment({ ...base, MONGODB_URI: undefined }),
    ).toThrow('Invalid environment configuration');
  });

  it('converts the dotenv port value to a number', () => {
    const config = validateEnvironment({
      PORT: '8085',
      ...base,
    });

    expect(config.PORT).toBe(8085);
    expect(config.SERVICE_NAME).toBe('hs-notification-service');
  });

  it('requires a gateway internal secret with no default', () => {
    expect(() => validateEnvironment({ ...base, GATEWAY_INTERNAL_SECRET: undefined })).toThrow(
      'Invalid environment configuration',
    );
    expect(() =>
      validateEnvironment({ ...base, GATEWAY_INTERNAL_SECRET: '' }),
    ).toThrow('Invalid environment configuration');
  });

  it('rejects a short gateway internal secret without leaking its value', () => {
    const shortSecret = 'short-sensitive-secret';
    let caught: Error | undefined;
    try {
      validateEnvironment({ ...base, GATEWAY_INTERNAL_SECRET: shortSecret });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.message).toContain('Invalid environment configuration');
    expect(caught?.message).not.toContain(shortSecret);
  });
});
