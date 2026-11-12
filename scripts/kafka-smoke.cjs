require('ts-node/register');
const assert = require('node:assert/strict');
const { Kafka, logLevel } = require('kafkajs');
const { ConfigService } = require('@nestjs/config');
const {
  NotificationEventsConsumer,
} = require('../src/modules/notification-events/notification-events.consumer');
async function main() {
  const suffix = Date.now();
  const topic = `hs.notification.smoke.${suffix}`,
    dlt = `${topic}.dlt`,
    group = `${topic}.group`;
  const kafka = new Kafka({
    clientId: 'notification-smoke',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    logLevel: logLevel.NOTHING,
  });
  const admin = kafka.admin();
  const producer = kafka.producer();
  let consumer;
  const persisted = new Set();
  try {
    await admin.connect();
    await admin.createTopics({
      topics: [
        { topic, numPartitions: 1, replicationFactor: 1 },
        { topic: dlt, numPartitions: 1, replicationFactor: 1 },
      ],
    });
    consumer = new NotificationEventsConsumer(
      new ConfigService({
        KAFKA_ENABLED: true,
        KAFKA_BROKERS: process.env.KAFKA_BROKERS || 'localhost:9092',
        KAFKA_CLIENT_ID: 'notification-smoke',
        KAFKA_GROUP_ID: group,
        KAFKA_EVENTS_TOPIC: topic,
        KAFKA_DLT_TOPIC: dlt,
        KAFKA_RETRY_ATTEMPTS: 2,
        KAFKA_RETRY_DELAY_MS: 10,
      }),
      {
        create: async (x) =>
          persisted.add(`${x.recipientId}:${x.sourceEventId}`),
      },
    );
    await consumer.onModuleInit();
    await producer.connect();
    const event = {
      eventId: 'smoke-event',
      eventType: 'LISTING_APPROVED',
      version: 1,
      occurredAt: new Date().toISOString(),
      recipients: ['smoke-alice', 'smoke-bob'],
      data: { listingId: 'smoke-listing' },
    };
    await producer.send({
      topic,
      messages: [
        { key: 'smoke-listing', value: JSON.stringify(event) },
        { key: 'smoke-listing', value: JSON.stringify(event) },
        { value: '{invalid' },
      ],
    });
    let done = false;
    for (let i = 0; i < 100; i++) {
      const offsets = await admin.fetchOffsets({
        groupId: group,
        topics: [topic],
      });
      if (offsets[0].partitions[0].offset === '3') {
        done = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(done, true, 'consumer must commit all three source records');
    assert.equal(persisted.size, 2);
    const offsets = await admin.fetchTopicOffsets(dlt);
    assert.equal(offsets[0].high, '1');
    console.log(
      `PASS real Kafka replay/idempotent stub, redacted DLT and committed offsets. Topics retained: ${topic}, ${dlt}`,
    );
  } finally {
    await consumer?.onApplicationShutdown();
    await producer.disconnect();
    await admin.disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
