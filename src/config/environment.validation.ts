import { plainToInstance, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 8085;

  @IsString()
  SERVICE_NAME = 'hs-notification-service';

  @IsString()
  @IsNotEmpty()
  MONGODB_URI!: string;

  // Shared with hs-gateway-server (X-Internal-Secret). Required; no default.
  @IsString()
  @MinLength(32)
  GATEWAY_INTERNAL_SECRET!: string;

  @IsUrl({ require_tld: false })
  EUREKA_CLIENT_SERVICE_URL = 'http://localhost:8761/eureka';

  @IsString()
  EUREKA_INSTANCE_HOSTNAME = 'localhost';
}

export function validateEnvironment(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
    validationError: { target: false, value: false },
  });

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }

  const feature = (name: string): boolean => {
    const value = config[name];
    if (value === undefined || value === '' || value === false || value === 'false') return false;
    if (value === true || value === 'true') return true;
    throw new Error(`Invalid environment configuration: ${name} must be true or false`);
  };
  const required = (name: string): string => {
    const value = config[name];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Invalid environment configuration: ${name} is required`);
    }
    return value.trim();
  };
  const integer = (name: string, min: number, max: number): number => {
    const raw = required(name);
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`Invalid environment configuration: ${name} is out of range`);
    }
    return value;
  };
  const settings: Record<string, unknown> = { ...validated };
  for (const name of ['KAFKA_ENABLED', 'PUSH_ENABLED', 'NOTIFICATION_REALTIME_ENABLED']) {
    settings[name] = feature(name);
  }
  if (settings.KAFKA_ENABLED) {
    for (const name of ['KAFKA_BROKERS', 'KAFKA_CLIENT_ID', 'KAFKA_GROUP_ID', 'KAFKA_EVENTS_TOPIC', 'KAFKA_DLT_TOPIC']) settings[name] = required(name);
    if (settings.KAFKA_EVENTS_TOPIC === settings.KAFKA_DLT_TOPIC) throw new Error('Kafka events and DLT topics must differ');
    settings.KAFKA_RETRY_ATTEMPTS = integer('KAFKA_RETRY_ATTEMPTS', 1, 10);
    settings.KAFKA_RETRY_DELAY_MS = integer('KAFKA_RETRY_DELAY_MS', 0, 10000);
  }
  if (settings.PUSH_ENABLED) {
    for (const name of ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']) settings[name] = required(name);
  }
  if (settings.NOTIFICATION_REALTIME_ENABLED) {
    for (const name of ['KEYCLOAK_ISSUER_URL', 'KEYCLOAK_AUDIENCE', 'NOTIFICATION_REALTIME_ORIGINS']) settings[name] = required(name);
    const issuer = new URL(settings.KEYCLOAK_ISSUER_URL as string);
    if (!['http:', 'https:'].includes(issuer.protocol) || issuer.username || issuer.password || issuer.search || issuer.hash) throw new Error('Invalid KEYCLOAK_ISSUER_URL');
    for (const origin of (settings.NOTIFICATION_REALTIME_ORIGINS as string).split(',')) {
      const parsed = new URL(origin.trim());
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin.trim()) throw new Error('Invalid NOTIFICATION_REALTIME_ORIGINS');
    }
  }
  if (config.USER_DIRECTORY_URL) {
    const directory = new URL(required('USER_DIRECTORY_URL'));
    if (!['http:', 'https:'].includes(directory.protocol) || directory.username || directory.password || directory.search || directory.hash || !directory.pathname.endsWith('/api/v1/admin/users')) {
      throw new Error('Invalid USER_DIRECTORY_URL');
    }
    settings.USER_DIRECTORY_URL = directory.toString();
  }
  return settings;
}
