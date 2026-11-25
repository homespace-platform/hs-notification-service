import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { NOTIFICATION_CATEGORIES } from '../notification/domain/notification.model';

const send = jest.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue('provider-accepted');
jest.unstable_mockModule('firebase-admin/messaging', () => ({ getMessaging: () => ({ send }) }));

const NATIVE_TOKEN = `fcm-${'a'.repeat(60)}:APA91b_${'Z-9'.repeat(30)}`;

describe('Firebase push privacy', () => {
  let Provider: typeof import('./firebase-push.provider.js').FirebasePushProvider;
  beforeAll(async () => { Provider = (await import('./firebase-push.provider.js')).FirebasePushProvider; });
  beforeEach(() => { send.mockClear(); });
  const provider = () => {
    const p = new Provider(new ConfigService({ PUSH_ENABLED: true }));
    // Inject an inert app so this unit test never initializes credentials or calls Firebase.
    Object.assign(p, { app: {} });
    return p;
  };

  it('web (and legacy rows without platform) keep the exact generic Web Push message', async () => {
    const expected = {
      fid: 'test-fid', data: { event: 'notifications.changed' },
      webpush: { headers: { TTL: '300' }, notification: {
        title: 'HomeSpace', body: 'Bạn có thông báo mới.', tag: 'homespace-notification',
      } },
    };
    await expect(provider().send({ fid: 'test-fid', platform: 'web' }, 'CHAT')).resolves.toBe('provider-accepted');
    await provider().send({ fid: 'test-fid' }, 'NEWS');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, expected);
    expect(send).toHaveBeenNthCalledWith(2, expected);
  });

  it.each(['android', 'ios'] as const)('%s sends a display notification to the native token with Android/APNs options', async (platform) => {
    await provider().send({ fid: NATIVE_TOKEN, platform }, 'PAYMENT');
    expect(send).toHaveBeenCalledWith({
      token: NATIVE_TOKEN,
      notification: { title: 'HomeSpace', body: 'Bạn có thông báo mới.' },
      data: { event: 'notifications.changed', category: 'PAYMENT' },
      android: {
        priority: 'high', ttl: 300000, collapseKey: 'hs-payment',
        notification: { channelId: 'homespace-notifications', tag: 'hs-payment' },
      },
      apns: {
        headers: { 'apns-priority': '10', 'apns-collapse-id': 'hs-payment' },
        payload: { aps: { sound: 'default' } },
      },
    });
  });

  it('uses chat copy only for CHAT and never targets a native token as fid', async () => {
    await provider().send({ fid: NATIVE_TOKEN, platform: 'android' }, 'CHAT');
    const message = send.mock.calls[0][0] as Record<string, any>;
    expect(message.notification.body).toBe('Bạn có tin nhắn mới.');
    expect(message).not.toHaveProperty('fid');
    expect(message).not.toHaveProperty('webpush');
  });

  it.each(NOTIFICATION_CATEGORIES)('native %s payload carries only event and category', async (category) => {
    await provider().send({ fid: NATIVE_TOKEN, platform: 'android' }, category);
    const message = send.mock.calls[0][0] as Record<string, any>;
    expect(Object.keys(message.data).sort()).toEqual(['category', 'event']);
    expect(Object.keys(message).sort()).toEqual(['android', 'apns', 'data', 'notification', 'token']);
    // Nothing but static copy, category-derived keys and the token may appear.
    const json = JSON.stringify({ ...message, token: undefined });
    for (const secret of ['private title', 'private body', 'actionPath', 'notificationId', 'recipient', 'metadata', 'alice'])
      expect(json).not.toContain(secret);
  });

  it('disabled push makes no provider call', async () => {
    const p = new Provider(new ConfigService({ PUSH_ENABLED: false }));
    await expect(p.send({ fid: 'test-fid' }, 'NEWS')).rejects.toThrow('Push disabled');
    expect(send).not.toHaveBeenCalled();
  });
});
