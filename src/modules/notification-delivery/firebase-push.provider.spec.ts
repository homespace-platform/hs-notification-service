import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';

const send = jest.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue('provider-accepted');
jest.unstable_mockModule('firebase-admin/messaging', () => ({ getMessaging: () => ({ send }) }));

describe('Firebase push privacy', () => {
  let Provider: typeof import('./firebase-push.provider.js').FirebasePushProvider;
  beforeAll(async () => { Provider = (await import('./firebase-push.provider.js')).FirebasePushProvider; });
  beforeEach(() => { send.mockClear(); });

  it('sends only a generic signal and copy, without listing content, identity or deep links', async () => {
    const provider = new Provider(new ConfigService({ PUSH_ENABLED: true }));
    // Inject an inert app so this unit test never initializes credentials or calls Firebase.
    Object.assign(provider, { app: {} });
    await expect(provider.send('test-fid')).resolves.toBe('provider-accepted');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      fid: 'test-fid', data: { event: 'notifications.changed' },
      webpush: { headers: { TTL: '300' }, notification: {
        title: 'HomeSpace', body: 'Bạn có thông báo mới.', tag: 'homespace-notification',
      } },
    });
  });

  it('disabled push makes no provider call', async () => {
    const provider = new Provider(new ConfigService({ PUSH_ENABLED: false }));
    await expect(provider.send('test-fid')).rejects.toThrow('Push disabled');
    expect(send).not.toHaveBeenCalled();
  });
});
