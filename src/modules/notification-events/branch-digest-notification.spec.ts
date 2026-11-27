import { parseNotificationEvent, renderNotification } from './notification-event';

const event = {
  eventId: '550e8400-e29b-41d4-a716-446655440000',
  eventType: 'BRANCH_DAILY_DIGEST',
  version: 1,
  occurredAt: '2026-11-27T01:00:00.000Z',
  recipients: ['owner-a'],
  data: { attentionCount: '5' },
};
const parse = (value: unknown) => parseNotificationEvent(Buffer.from(JSON.stringify(value)));

describe('branch digest notification contract', () => {
  it('renders just the count, a fixed branch route and the original replay identity', () => {
    expect(renderNotification(parse(event), 'owner-a')).toEqual({
      recipientId: 'owner-a',
      sourceEventId: event.eventId,
      type: event.eventType,
      category: 'SYSTEM',
      priority: 'NORMAL',
      title: 'Việc cần chú ý hôm nay',
      body: 'Bạn có 5 việc cần chú ý tại các chi nhánh.',
      actionPath: '/dashboard/branches',
      metadata: {},
    });
    expect(parse({ ...event, data: { attentionCount: '999999999999999' } }).data)
      .toEqual({ attentionCount: '999999999999999' });
  });

  it.each([
    { attentionCount: 5 }, { attentionCount: '0' }, { attentionCount: '01' },
    { attentionCount: '-1' }, { attentionCount: '1.5' }, { attentionCount: '5\n' },
    { attentionCount: '1000000000000000' }, { attentionCount: '5', branchId: 'private' }, {},
  ])('rejects invalid or excess data %j', data => {
    expect(() => parse({ ...event, data })).toThrow('Invalid notification event');
  });

  it.each([
    { recipients: [] }, { recipients: ['owner-a', 'owner-b'] }, { recipients: ['owner-a', 'owner-a'] },
    { actionPath: '/private' }, { version: 2 }, { occurredAt: '2026-11-27T01:00:00Z' },
  ])('rejects invalid envelope fields %j', overrides => {
    expect(() => parse({ ...event, ...overrides })).toThrow('Invalid notification event');
  });
});
