import { jest } from '@jest/globals';
import { createConnection, Connection, Model } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { validate } from 'class-validator';
import {
  Device,
  DeviceSchema,
  Delivery,
  DeliverySchema,
} from './delivery.schema';
import {
  NotificationDeliveryService,
  retryDelay,
} from './notification-delivery.service';
import { FirebasePushProvider } from './firebase-push.provider';
import { RegisterDeviceDto } from './device.controller';
import {
  NotificationDocument,
  NotificationSchema,
} from '../notification/infrastructure/notification.schema';
import {
  NotificationPreferenceDocument,
  NotificationPreferenceSchema,
} from '../notification/infrastructure/notification-preference.schema';

describe('push contract', () => {
  it('requires explicit boolean enablement', () => {
    for (const value of [undefined, false, 'true']) {
      expect(
        new FirebasePushProvider(new ConfigService({ PUSH_ENABLED: value }))
          .enabled,
      ).toBe(false);
    }
    expect(
      new FirebasePushProvider(new ConfigService({ PUSH_ENABLED: true }))
        .enabled,
    ).toBe(true);
  });
  it('rejects legacy token, weak proof, and client supplied owner', async () => {
    const dto = Object.assign(new RegisterDeviceDto(), {
      installationId: randomUUID(),
      installationSecret: 'weak',
      fid: 'legacy:token',
      userId: 'victim',
    });
    expect(
      (await validate(dto, { whitelist: true, forbidNonWhitelisted: true }))
        .map((e) => e.property)
        .sort(),
    ).toEqual(['fid', 'installationSecret', 'userId']);
  });
  it('backs off with a bounded delay', () => {
    expect([1, 2, 3, 4, 100].map(retryDelay)).toEqual([
      60000, 120000, 240000, 480000, 3600000,
    ]);
  });
});

// Explicit opt-in test database; no application credentials or .env are read.
const mongoDescribe = process.env.TEST_MONGODB_URI ? describe : describe.skip;
mongoDescribe('durable push dispatcher (Mongo)', () => {
  let connection: Connection;
  let devices: Model<Device>;
  let jobs: Model<Delivery>;
  let notifications: Model<NotificationDocument>;
  let preferences: Model<NotificationPreferenceDocument>;
  let service: NotificationDeliveryService;
  let push: {
    enabled: boolean;
    send: ReturnType<typeof jest.fn<(fid: string) => Promise<string>>>;
  };
  const proof = () => ({
    installationId: randomUUID(),
    installationSecret: randomBytes(32).toString('base64url'),
    fid: `c${randomBytes(16).toString('base64url').slice(0, 21)}`,
  });
  const notification = async () =>
    notifications.create({
      recipientId: 'alice',
      sourceEventId: randomUUID(),
      category: 'CHAT',
      type: 'CHAT_MESSAGE',
      title: 'private title',
      body: 'private body',
      priority: 'NORMAL',
    });

  beforeAll(async () => {
    connection = await createConnection(process.env.TEST_MONGODB_URI!, {
      dbName: `notification_push_test_${randomUUID().replace(/-/g, '')}`,
    }).asPromise();
    devices = connection.model<Device>('Device', DeviceSchema);
    jobs = connection.model<Delivery>('Delivery', DeliverySchema);
    notifications = connection.model<NotificationDocument>(
      NotificationDocument.name,
      NotificationSchema,
    );
    preferences = connection.model<NotificationPreferenceDocument>(
      NotificationPreferenceDocument.name,
      NotificationPreferenceSchema,
    );
    await Promise.all([
      devices.init(),
      jobs.init(),
      notifications.init(),
      preferences.init(),
    ]);
  });
  beforeEach(async () => {
    await Promise.all([
      devices.deleteMany({}),
      jobs.deleteMany({}),
      notifications.deleteMany({}),
      preferences.deleteMany({}),
    ]);
    push = {
      enabled: true,
      send: jest
        .fn<(fid: string) => Promise<string>>()
        .mockResolvedValue('projects/test/messages/accepted'),
    };
    service = new NotificationDeliveryService(
      devices,
      jobs,
      notifications,
      preferences,
      push as unknown as FirebasePushProvider,
    );
  });
  afterAll(async () => {
    try {
      await connection.dropDatabase();
    } finally {
      await connection.close();
    }
  });

  it('deduplicates jobs per device and recovers notifications without an enqueue hook', async () => {
    await service.register('alice', proof());
    await service.register('alice', proof());
    const row = await notification();
    await service.tick();
    await service.enqueue({ id: row.id, createdAt: row.createdAt }, 'alice');
    await service.tick();
    expect(await jobs.countDocuments()).toBe(2);
    expect(await jobs.countDocuments({ status: 'accepted' })).toBe(2);
    expect(push.send).toHaveBeenCalledTimes(2);
    expect(await notifications.countDocuments({ readAt: null })).toBe(1);
  });
  it('requires installation proof and scopes unregister to the current user', async () => {
    const device = proof();
    await service.register('alice', device);
    await expect(
      service.register('bob', { ...device, installationSecret: 'incorrect' }),
    ).rejects.toThrow('proof');
    await service.unregister(
      'bob',
      device.installationId,
      device.installationSecret,
    );
    expect(
      await devices.countDocuments({ userId: 'alice', active: true }),
    ).toBe(1);
    await service.unregister(
      'alice',
      device.installationId,
      device.installationSecret,
    );
    expect(await devices.countDocuments({ active: true })).toBe(0);
  });
  it('does not send queued jobs after a browser switches account', async () => {
    const device = proof();
    await service.register('alice', device);
    const row = await notification();
    await service.enqueue({ id: row.id, createdAt: row.createdAt }, 'alice');
    await service.register('bob', device);
    await service.unregister(
      'alice',
      device.installationId,
      device.installationSecret,
    );
    await service.tick();
    expect(push.send).not.toHaveBeenCalled();
    expect(await jobs.countDocuments({ status: 'skipped' })).toBe(1);
    expect(await devices.countDocuments({ userId: 'bob', active: true })).toBe(
      1,
    );
  });
  it('keeps durable work while disabled and rechecks preferences before sending', async () => {
    await service.register('alice', proof());
    await notification();
    push.enabled = false;
    await service.tick();
    expect(await jobs.countDocuments({ status: 'pending', attempts: 0 })).toBe(
      1,
    );
    await preferences.create({
      userId: 'alice',
      items: [{ category: 'CHAT', push: false, email: true }],
      updatedAt: new Date(),
    });
    push.enabled = true;
    await service.tick();
    expect(push.send).not.toHaveBeenCalled();
    expect(await notifications.countDocuments()).toBe(1);
    expect(await jobs.countDocuments({ status: 'skipped' })).toBe(1);
  });
  it('retries outage with backoff then bounds attempts without losing in-app', async () => {
    await service.register('alice', proof());
    await notification();
    push.send.mockRejectedValue({ code: 'messaging/server-unavailable' });
    await service.tick();
    const job = await jobs.findOne().lean().exec();
    expect(job?.status).toBe('pending');
    expect(job?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
    for (let i = 0; i < 5; i++) {
      await jobs.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
      await service.tick();
    }
    expect(push.send).toHaveBeenCalledTimes(5);
    expect(await jobs.countDocuments({ status: 'failed', attempts: 5 })).toBe(
      1,
    );
    expect(await notifications.countDocuments()).toBe(1);
  });
  it('deactivates invalid registration and never retries it', async () => {
    await service.register('alice', proof());
    await notification();
    push.send.mockRejectedValue({
      code: 'messaging/registration-token-not-registered',
    });
    await service.tick();
    await service.tick();
    expect(push.send).toHaveBeenCalledTimes(1);
    expect(await devices.countDocuments({ active: true })).toBe(0);
    expect(await jobs.countDocuments({ status: 'failed' })).toBe(1);
  });
});
