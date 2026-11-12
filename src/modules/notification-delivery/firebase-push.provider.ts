import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

@Injectable()
export class FirebasePushProvider implements OnModuleDestroy {
  private app?: App;
  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.config.get<boolean>('PUSH_ENABLED') === true;
  }

  async send(fid: string): Promise<string> {
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
    // Generic signal prevents an already in-flight push exposing the previous browser user's content.
    return getMessaging(this.app).send({
      fid,
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
