import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { NotificationCategory } from '../notification/domain/notification.model';
import type { DevicePlatform } from './delivery.schema';

export const ANDROID_CHANNEL_ID = 'homespace-notifications';
export interface PushTarget {
  fid: string;
  /** Records created before native support have no platform and are web. */
  platform?: DevicePlatform;
}

@Injectable()
export class FirebasePushProvider implements OnModuleDestroy {
  private app?: App;
  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.config.get<boolean>('PUSH_ENABLED') === true;
  }

  /** `device.fid` is the push address for `device.platform` (web FID or native FCM token). */
  async send(
    device: PushTarget,
    category: NotificationCategory,
  ): Promise<string> {
    if (!this.enabled) throw new Error('Push disabled');
    if (!this.app) {
      const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
      const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
      const privateKey = this.config
        .get<string>('FIREBASE_PRIVATE_KEY')
        ?.replace(/\\n/g, '\n');
      if (!projectId || !clientEmail || !privateKey)
        throw new Error('Push credentials missing');
      this.app = initializeApp(
        { credential: cert({ projectId, clientEmail, privateKey }) },
        'notification-push',
      );
    }
    const messaging = getMessaging(this.app);
    // Native: a display notification (data-only is unreliable when the app is killed). Generic copy only.
    if (device.platform === 'android' || device.platform === 'ios') {
      const collapse = `hs-${category.toLowerCase()}`;
      return messaging.send({
        token: device.fid,
        notification: {
          title: 'HomeSpace',
          body:
            category === 'CHAT'
              ? 'Bạn có tin nhắn mới.'
              : 'Bạn có thông báo mới.',
        },
        data: { event: 'notifications.changed', category },
        android: {
          priority: 'high',
          ttl: 300_000,
          collapseKey: collapse,
          notification: { channelId: ANDROID_CHANNEL_ID, tag: collapse },
        },
        apns: {
          headers: { 'apns-priority': '10', 'apns-collapse-id': collapse },
          payload: { aps: { sound: 'default' } },
        },
      });
    }
    // Generic signal prevents an already in-flight push exposing the previous browser user's content.
    return messaging.send({
      fid: device.fid,
      data: { event: 'notifications.changed' },
      webpush: {
        headers: { TTL: '300' },
        notification: {
          title: 'HomeSpace',
          body: 'Bạn có thông báo mới.',
          tag: 'homespace-notification',
        },
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) await deleteApp(this.app);
  }
}
