import 'reflect-metadata';
import { validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  it('fails fast when MONGODB_URI is missing', () => {
    expect(() => validateEnvironment({})).toThrow(
      'Invalid environment configuration',
    );
  });

  it('converts the dotenv port value to a number', () => {
    const config = validateEnvironment({
      PORT: '8085',
      MONGODB_URI: 'mongodb://database.example/homespace_notification',
    });

    expect(config.PORT).toBe(8085);
    expect(config.SERVICE_NAME).toBe('hs-notification-service');
  });
});
