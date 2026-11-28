import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationService } from '../notification/application/notification.service';
import { NOTIFICATION_CATEGORIES } from '../notification/domain/notification.model';
import { FeedQueryDto, UpdatePreferencesDto } from '../notification/presentation/dto/notification.dto';
import { InMemoryNotificationRepository, InMemoryPreferenceRepository } from '../notification/testing/in-memory-notification.repository';
import { parseNotificationEvent, renderNotification } from './notification-event';
import { NotificationEventsConsumer } from './notification-events.consumer';

const news = {
  eventId: 'news_4a5a7032-5ce9-4af5-b6c0-1022a38d9165',
  eventType: 'NEWS_PUBLISHED',
  version: 1,
  occurredAt: '2026-11-15T00:00:00.000Z',
  recipients: ['alice', 'bob'],
  data: { newsId: '4a5a7032-5ce9-4af5-b6c0-1022a38d9165', slug: 'tin-tuc-moi' },
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('news notification contract', () => {
  it('accepts targeted recipients and trusted routing fields', () => {
    const parsed = parseNotificationEvent(encode(news));
    expect(parsed.recipients).toEqual(['alice', 'bob']);
    expect(parseNotificationEvent(encode({ ...news, recipients: Array.from({ length: 100 }, (_, i) => `user-${i}`) })).recipients).toHaveLength(100);
    expect(renderNotification(parsed, 'alice')).toMatchObject({
      recipientId: 'alice', sourceEventId: news.eventId, type: 'NEWS_PUBLISHED',
      category: 'NEWS', priority: 'NORMAL', actionPath: '/news/tin-tuc-moi',
      metadata: { newsId: news.data.newsId },
    });
    for (const invalid of [
      { ...news, recipients: [] },
      { ...news, recipients: ['alice', 'alice'] },
      { ...news, recipients: ['../admin'] },
      { ...news, recipients: Array.from({ length: 101 }, (_, i) => `user-${i}`) },
      { ...news, eventId: 'different' },
      { ...news, data: { ...news.data, title: 'private' } },
      { ...news, data: { ...news.data, newsId: '../admin' } },
      { ...news, data: { ...news.data, slug: '../admin' } },
      { ...news, data: { ...news.data, slug: 'x'.repeat(256) } },
      { ...news, data: { slug: news.data.slug } },
      { ...news, eventType: 'PLATFORM_ANNOUNCEMENT' },
    ]) expect(() => parseNotificationEvent(encode(invalid))).toThrow('Invalid notification event');
  });

  it('defaults NEWS delivery on and accepts a per-user opt-out', async () => {
    const notifications = new NotificationService(new InMemoryNotificationRepository(), new InMemoryPreferenceRepository());
    expect(NOTIFICATION_CATEGORIES).toContain('NEWS');
    expect((await notifications.getPreferences('alice')).find(item => item.category === 'NEWS'))
      .toEqual({ category: 'NEWS', push: true, email: true });
    await notifications.updatePreferences('alice', [{ category: 'NEWS', push: false, email: false }]);
    expect((await notifications.getPreferences('alice')).find(item => item.category === 'NEWS')?.push).toBe(false);
    expect((await notifications.getPreferences('bob')).find(item => item.category === 'NEWS')?.push).toBe(true);
    expect(await validate(plainToInstance(FeedQueryDto, { category: 'NEWS' }))).toEqual([]);
    expect(await validate(plainToInstance(UpdatePreferencesDto, { items: [{ category: 'NEWS', push: false, email: false }] }))).toEqual([]);
  });
});

describe('targeted news delivery', () => {
  beforeEach(() => jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected recipient HTTP lookup')));
  afterEach(() => jest.restoreAllMocks());

  const setup = () => {
    const repo = new InMemoryNotificationRepository();
    const notifications = new NotificationService(repo, new InMemoryPreferenceRepository());
    const consumer = new NotificationEventsConsumer(new ConfigService({
      KAFKA_RETRY_ATTEMPTS: 2, KAFKA_RETRY_DELAY_MS: 0, KAFKA_DLT_TOPIC: 'dlt',
    }), notifications);
    const commitOffsets = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();
    const send = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();
    Object.assign(consumer, { consumer: { commitOffsets }, producer: { send } });
    const payload = {
      topic: 'events', partition: 0, message: { offset: '12', value: encode(news) },
      heartbeat: jest.fn<() => Promise<void>>().mockResolvedValue(),
    } as unknown as Parameters<typeof consumer.consume>[0];

    return { repo, notifications, consumer, commitOffsets, send, payload };
  };

  it('persists only targeted users before committing and deduplicates chunks/replay without HTTP', async () => {
    const x = setup();
    const create = jest.spyOn(x.notifications, 'create');
    await x.notifications.updatePreferences('alice', [{ category: 'NEWS', push: false, email: false }]);
    await x.consumer.consume(x.payload);
    await x.consumer.consume(x.payload);
    await x.consumer.consume({ ...x.payload, message: { ...x.payload.message,
      offset: '13', value: encode({ ...news, recipients: ['bob', 'carol'] }),
    } });
    expect(x.repo.rows.map(row => row.recipientId)).toEqual(['alice', 'bob', 'carol']);
    expect(x.repo.rows.every(row => row.sourceEventId === news.eventId)).toBe(true);
    expect(create.mock.invocationCallOrder[1]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
    expect(x.commitOffsets).toHaveBeenLastCalledWith([{ topic: 'events', partition: 0, offset: '14' }]);
    expect(x.send).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retries partial persistence without duplicate records or a DLT', async () => {
    const x = setup();
    const originalCreate = x.notifications.create.bind(x.notifications);
    const create = jest.spyOn(x.notifications, 'create')
      .mockImplementationOnce(originalCreate)
      .mockRejectedValueOnce(new Error('MongoDB unavailable'));
    await x.consumer.consume(x.payload);
    expect(create.mock.calls.map(([input]) => input.recipientId)).toEqual(['alice', 'bob', 'alice', 'bob']);
    expect(x.repo.rows.map(row => row.recipientId)).toEqual(['alice', 'bob']);
    expect(x.commitOffsets).toHaveBeenCalledTimes(1);
    expect(x.send).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retains exhausted persistence failures in the source topic', async () => {
    const x = setup();
    jest.spyOn(x.notifications, 'create').mockRejectedValue(new Error('MongoDB unavailable'));
    await expect(x.consumer.consume(x.payload)).rejects.toThrow('Notification persistence unavailable');
    expect(x.commitOffsets).not.toHaveBeenCalled();
    expect(x.send).not.toHaveBeenCalled();
  });

  it('quarantines an empty-recipient source event before committing without creating notifications', async () => {
    const x = setup();
    x.payload.message.value = encode({ ...news, recipients: [] });
    await x.consumer.consume(x.payload);
    expect(x.repo.rows).toEqual([]);
    expect(x.send).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'dlt', acks: -1,
      messages: [expect.objectContaining({ key: 'events:0:12', value: expect.stringContaining('INVALID_EVENT') })],
    }));
    expect(JSON.stringify(x.send.mock.calls)).not.toContain(news.data.slug);
    expect(x.send.mock.invocationCallOrder[0]).toBeLessThan(x.commitOffsets.mock.invocationCallOrder[0]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
