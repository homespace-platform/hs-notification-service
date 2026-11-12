const { Kafka, logLevel } = require('kafkajs');
const { readFile } = require('node:fs/promises');
async function main() {
  const path = process.argv[2];
  if (!path || !process.env.KAFKA_BROKERS || !process.env.KAFKA_EVENTS_TOPIC)
    throw new Error(
      'Usage: KAFKA_BROKERS + KAFKA_EVENTS_TOPIC node scripts/kafka-publish.cjs <event.json>',
    );
  const event = JSON.parse(await readFile(path, 'utf8'));
  // Validate with the same contract used by the service before publishing.
  require('ts-node/register');
  const {
    parseNotificationEvent,
  } = require('../src/modules/notification-events/notification-event');
  parseNotificationEvent(Buffer.from(JSON.stringify(event)));
  const producer = new Kafka({
    clientId: 'hs-notification-test-publisher',
    brokers: process.env.KAFKA_BROKERS.split(',').map((x) => x.trim()),
    logLevel: logLevel.NOTHING,
  }).producer({ allowAutoTopicCreation: false });
  const resourceId = Object.values(event.data)[0];
  await producer.connect();
  try {
    await producer.send({
      topic: process.env.KAFKA_EVENTS_TOPIC,
      acks: -1,
      messages: [
        {
          key:
            event.eventType === 'PLATFORM_ANNOUNCEMENT'
              ? event.eventId
              : resourceId,
          value: JSON.stringify(event),
        },
      ],
    });
    console.log('Event published. Reusing eventId tests idempotency.');
  } finally {
    await producer.disconnect();
  }
}
main().catch(() => {
  console.error(
    'Publish failed; check contract, configuration and broker/topic availability.',
  );
  process.exitCode = 1;
});
