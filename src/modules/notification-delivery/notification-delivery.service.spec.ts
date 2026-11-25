import { jest } from '@jest/globals';
import { createConnection, Connection, Model } from 'mongoose';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
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
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
} from '../notification/domain/notification.model';

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

  it.each(NOTIFICATION_CATEGORIES)(
    'skips disabled %s push at dispatch for every priority',
    async (category) => {
      for (const priority of NOTIFICATION_PRIORITIES) {
        const job = {
          notificationId: 'notification-1',
          recipientId: 'alice',
          installationId: 'installation-1',
          generation: 'generation-1',
          attempts: 1,
        } as Delivery;
        const lease = jest
          .fn<() => Promise<Delivery | null>>()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null);
        const updateOne = jest.fn(() => ({ exec: async () => undefined }));
        const devices = {
          findOne: jest.fn(() => ({
            lean: () => ({ exec: async () => ({ fid: 'unused' }) }),
          })),
        };
        const deliveries = {
          findOneAndUpdate: () => ({ lean: () => ({ exec: lease }) }),
          updateOne,
          updateMany: () => ({ exec: async () => undefined }),
        };
        const notifications = {
          collection: {
            find: () => ({
              sort: () => ({ limit: () => ({ toArray: async () => [] }) }),
            }),
          },
          findOne: () => ({
            lean: () => ({ exec: async () => ({ category, priority }) }),
          }),
        };
        const preferences = {
          findOne: jest.fn(() => ({
            lean: () => ({
              exec: async () => ({
                items: [{ category, push: false, email: true }],
              }),
            }),
          })),
        };
        const push = { enabled: true, send: jest.fn() };
        const service = new NotificationDeliveryService(
          devices as unknown as Model<Device>,
          deliveries as unknown as Model<Delivery>,
          notifications as unknown as Model<NotificationDocument>,
          preferences as unknown as Model<NotificationPreferenceDocument>,
          push as unknown as FirebasePushProvider,
        );

        await service.tick();

        expect(preferences.findOne).toHaveBeenCalledWith({ userId: 'alice' });
        expect(updateOne).toHaveBeenCalledWith(
          expect.objectContaining({
            notificationId: job.notificationId,
            installationId: job.installationId,
          }),
          { $set: { status: 'skipped' } },
        );
        expect(push.send).not.toHaveBeenCalled();
      }
    },
  );
});

describe('native device contract (no Mongo/Firebase)', () => {
  const secret = randomBytes(32).toString('base64url');
  const NATIVE = `${'a'.repeat(40)}:APA91b_${'Z-9.'.repeat(30)}`;
  const dto = (over: Record<string, unknown> = {}) =>
    Object.assign(new RegisterDeviceDto(), {
      installationId: randomUUID(),
      installationSecret: secret,
      fid: `c${'A'.repeat(21)}`,
      ...over,
    });
  const bad = async (over: Record<string, unknown>) =>
    (await validate(dto(over), { whitelist: true, forbidNonWhitelisted: true }))
      .map((e) => e.property)
      .sort();

  it('DTO: legacy web body (no platform) and explicit web stay valid', async () => {
    expect(await bad({})).toEqual([]);
    expect(await bad({ platform: 'web' })).toEqual([]);
  });
  it('DTO: android/ios accept a long FCM token, reject short or bad characters', async () => {
    for (const platform of ['android', 'ios']) {
      expect(await bad({ platform, fid: NATIVE })).toEqual([]);
      expect(await bad({ platform, fid: 'a'.repeat(59) })).toEqual(['fid']);
      expect(await bad({ platform, fid: 'a'.repeat(4097) })).toEqual(['fid']);
      expect(await bad({ platform, fid: `${'a'.repeat(60)}!` })).toEqual(['fid']);
    }
  });
  it('DTO: web rejects a native token and native rejects a web FID; unknown platform rejected', async () => {
    expect(await bad({ fid: NATIVE })).toEqual(['fid']);
    expect(await bad({ platform: 'web', fid: NATIVE })).toEqual(['fid']);
    expect(await bad({ platform: 'android' })).toEqual(['fid']);
    expect(await bad({ platform: 'windows', fid: NATIVE })).toEqual(['platform']);
  });

  function registry(existing?: Partial<Device>) {
    const updateOne = jest.fn(() => ({ exec: async () => undefined }));
    const devices = {
      findOne: () => ({ lean: () => ({ exec: async () => existing ?? null }) }),
      updateOne,
    };
    const service = new NotificationDeliveryService(
      devices as unknown as Model<Device>,
      {} as Model<Delivery>,
      {} as Model<NotificationDocument>,
      {} as Model<NotificationPreferenceDocument>,
      {} as FirebasePushProvider,
    );
    return { service, updateOne };
  }
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');

  it('registers a native device with its platform, keeping generation on idempotent refresh', async () => {
    const input = { installationId: randomUUID(), installationSecret: secret, fid: NATIVE, platform: 'android' as const };
    const fresh = registry();
    await fresh.service.register('alice', input);
    expect(fresh.updateOne).toHaveBeenCalledWith(
      { installationId: input.installationId, secretHash: hash(secret) },
      expect.objectContaining({ $set: expect.objectContaining({ userId: 'alice', fid: NATIVE, platform: 'android', active: true }) }),
      { upsert: true },
    );
    const registeredAt = new Date(1);
    const again = registry({ installationId: input.installationId, secretHash: hash(secret), userId: 'alice', fid: NATIVE, platform: 'android', active: true, generation: 'g1', registeredAt });
    await again.service.register('alice', input);
    const set = (again.updateOne.mock.calls[0] as unknown as [unknown, { $set: Device }])[1].$set;
    expect(set).toMatchObject({ generation: 'g1', registeredAt });
  });
  it('wrong secret and platform change are 409 and write nothing', async () => {
    const existing = { installationId: 'i', secretHash: hash(secret), userId: 'alice', fid: NATIVE, platform: 'android' as const, active: true, generation: 'g', registeredAt: new Date() };
    const r = registry(existing);
    await expect(r.service.register('alice', { installationId: 'i', installationSecret: 'x'.repeat(43), fid: NATIVE, platform: 'android' })).rejects.toThrow(ConflictException);
    await expect(r.service.register('alice', { installationId: 'i', installationSecret: secret, fid: `c${'A'.repeat(21)}` })).rejects.toThrow('platform');
    await expect(r.service.register('alice', { installationId: 'i', installationSecret: secret, fid: NATIVE, platform: 'ios' })).rejects.toThrow(ConflictException);
    expect(r.updateOne).not.toHaveBeenCalled();
  });
  it('legacy row without platform is web: web refresh ok, switching to android is 409', async () => {
    const legacy = { installationId: 'i', secretHash: hash(secret), userId: 'alice', fid: `c${'A'.repeat(21)}`, active: true, generation: 'g', registeredAt: new Date() };
    const r = registry(legacy);
    await r.service.register('alice', { installationId: 'i', installationSecret: secret, fid: legacy.fid });
    expect(r.updateOne).toHaveBeenCalledTimes(1);
    await expect(r.service.register('alice', { installationId: 'i', installationSecret: secret, fid: NATIVE, platform: 'android' })).rejects.toThrow('platform');
  });

  function dispatcher(platform: Device['platform'], category: string) {
    const job = { notificationId: 'n1', recipientId: 'alice', installationId: 'i1', generation: 'g1', attempts: 1 } as Delivery;
    const lease = jest.fn<() => Promise<Delivery | null>>().mockResolvedValueOnce(job).mockResolvedValue(null);
    const one = (value: unknown) => ({ lean: () => ({ exec: async () => value }) });
    const updateOne = jest.fn(() => ({ exec: async () => undefined }));
    const push = { enabled: true, send: jest.fn<(d: unknown, c: unknown) => Promise<string>>().mockResolvedValue('m1') };
    const service = new NotificationDeliveryService(
      { findOne: () => one({ installationId: 'i1', fid: 'token', platform, generation: 'g1' }) } as unknown as Model<Device>,
      { findOneAndUpdate: () => ({ lean: () => ({ exec: lease }) }), updateOne, updateMany: () => ({ exec: async () => undefined }) } as unknown as Model<Delivery>,
      { collection: { find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }) }, findOne: () => one({ category }) } as unknown as Model<NotificationDocument>,
      { findOne: () => one(null) } as unknown as Model<NotificationPreferenceDocument>,
      push as unknown as FirebasePushProvider,
    );
    return { service, push, updateOne };
  }
  it.each([['android', 'CHAT'], ['ios', 'PAYMENT'], [undefined, 'NEWS']] as const)('dispatch passes device %s and category %s to the provider', async (platform, category) => {
    const d = dispatcher(platform, category);
    await d.service.tick();
    expect(d.push.send).toHaveBeenCalledWith({ fid: 'token', platform }, category);
    expect(d.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: { status: 'accepted', providerMessageId: 'm1' } }));
  });

  describe('kick', () => {
    const started = () => {
      const s = new NotificationDeliveryService({} as Model<Device>, {} as Model<Delivery>, {} as Model<NotificationDocument>, {} as Model<NotificationPreferenceDocument>, {} as FirebasePushProvider);
      Object.assign(s, { timer: {} }); // simulate onModuleInit having run
      return s;
    };
    const flush = () => new Promise((r) => setImmediate(r));
    it('is a no-op before module start and while stopping', async () => {
      const s = new NotificationDeliveryService({} as Model<Device>, {} as Model<Delivery>, {} as Model<NotificationDocument>, {} as Model<NotificationPreferenceDocument>, {} as FirebasePushProvider);
      const tick = jest.spyOn(s, 'tick').mockResolvedValue();
      s.kick();
      await flush(); await flush();
      Object.assign(s, { timer: {}, stopping: true });
      s.kick();
      await flush(); await flush();
      expect(tick).not.toHaveBeenCalled();
    });
    it('coalesces many kicks into one tick, scheduled not inline', async () => {
      const s = started();
      const tick = jest.spyOn(s, 'tick').mockResolvedValue();
      s.kick(); s.kick(); s.kick();
      expect(tick).not.toHaveBeenCalled();
      await flush(); await flush();
      expect(tick).toHaveBeenCalledTimes(1);
    });
    it('a kick during a running tick triggers exactly one follow-up and no recursion', async () => {
      const s = started();
      const tick = jest.spyOn(s, 'tick');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      // Real tick() against a stub whose first scan blocks, so `running` stays true.
      Object.assign(s, {
        notifications: { collection: { find: () => ({ sort: () => ({ limit: () => ({ toArray: () => gate.then(() => []) }) }) }) } },
        push: { enabled: false },
      });
      const first = s.tick();
      s.kick(); s.kick();
      await flush(); await flush();
      expect(tick).toHaveBeenCalledTimes(1); // nothing re-entered while running
      release();
      await first;
      await flush(); await flush(); await flush();
      expect(tick).toHaveBeenCalledTimes(2); // one follow-up, then it settles
      await flush(); await flush();
      expect(tick).toHaveBeenCalledTimes(2);
    });
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
    send: ReturnType<typeof jest.fn<(d: unknown, c: unknown) => Promise<string>>>;
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
        .fn<(d: unknown, c: unknown) => Promise<string>>()
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
