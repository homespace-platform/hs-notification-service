import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Kafka,
  logLevel,
  type Consumer,
  type Producer,
  type EachMessagePayload,
} from 'kafkajs';
import { NotificationService } from '../notification/application/notification.service';
import {
  InvalidNotificationEvent,
  parseNotificationEvent,
  renderNotification,
} from './notification-event';

@Injectable()
export class NotificationEventsConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(NotificationEventsConsumer.name);
  private consumer?: Consumer;
  private producer?: Producer;
  private stopping = false;

  constructor(
    private readonly config: ConfigService,
    private readonly notifications: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<boolean>('KAFKA_ENABLED') !== true) return;
    const raw = this.config.getOrThrow<string | string[]>('KAFKA_BROKERS');
    const kafka = new Kafka({
      clientId: this.config.getOrThrow<string>('KAFKA_CLIENT_ID'),
      brokers: Array.isArray(raw)
        ? raw
        : raw.split(',').map((value) => value.trim()),
      // Never log broker error payloads, headers or business event contents.
      logLevel: logLevel.NOTHING,
    });
    this.consumer = kafka.consumer({
      groupId: this.config.getOrThrow<string>('KAFKA_GROUP_ID'),
      allowAutoTopicCreation: false,
    });
    this.producer = kafka.producer({ allowAutoTopicCreation: false });
    try {
      await this.producer.connect();
      await this.consumer.connect();
      await this.consumer.subscribe({
        topic: this.config.getOrThrow<string>('KAFKA_EVENTS_TOPIC'),
        fromBeginning: true,
      });
      await this.consumer.run({
        autoCommit: false,
        partitionsConsumedConcurrently: 1,
        eachMessage: (payload) => this.consume(payload),
      });
    } catch {
      await this.onApplicationShutdown();
      throw new Error('Kafka notification consumer startup failed');
    }
  }

  async consume({
    topic,
    partition,
    message,
    heartbeat,
  }: EachMessagePayload): Promise<void> {
    const attempts = this.config.getOrThrow<number>('KAFKA_RETRY_ATTEMPTS');
    const retryDelay = this.config.getOrThrow<number>('KAFKA_RETRY_DELAY_MS');
    if (
      !Number.isInteger(attempts) ||
      attempts < 1 ||
      attempts > 10 ||
      !Number.isInteger(retryDelay) ||
      retryDelay < 0 ||
      retryDelay > 10000
    )
      throw new Error('Invalid Kafka retry configuration');
    let failure: 'INVALID_EVENT' | 'PERSISTENCE_FAILED' | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (this.stopping) throw new Error('Kafka consumer stopping');
      try {
        const event = parseNotificationEvent(message.value);
        for (const recipient of event.recipients) {
          await this.notifications.create(renderNotification(event, recipient));
          await heartbeat();
        }
        failure = undefined;
        break;
      } catch (error) {
        failure =
          error instanceof InvalidNotificationEvent
            ? 'INVALID_EVENT'
            : 'PERSISTENCE_FAILED';
        if (failure === 'INVALID_EVENT' || attempt === attempts) break;
        await heartbeat();
        await delay(retryDelay);
      }
    }
    // Infrastructure failures remain in the durable source topic for recovery.
    if (failure === 'PERSISTENCE_FAILED') {
      const error = new Error('Notification persistence unavailable');
      Object.assign(error, { retriable: true });
      throw error;
    }
    if (failure) {
      // Source coordinates permit privileged replay without copying personal data into the DLT.
      await this.producer!.send({
        topic: this.config.getOrThrow<string>('KAFKA_DLT_TOPIC'),
        acks: -1,
        messages: [
          {
            key: `${topic}:${partition}:${message.offset}`,
            value: JSON.stringify({
              version: 1,
              source: { topic, partition, offset: message.offset },
              reason: failure,
              payloadSha256: createHash('sha256')
                .update(message.value ?? Buffer.alloc(0))
                .digest('hex'),
            }),
          },
        ],
      });
      this.logger.warn(`Kafka notification event quarantined (${failure})`);
    }
    if (this.stopping) throw new Error('Kafka consumer stopping');
    // Kafka stores the next offset; a crash before this commit replays idempotently.
    await this.consumer!.commitOffsets([
      { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
    ]);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    try {
      await this.consumer?.stop();
    } finally {
      await Promise.allSettled([
        this.consumer?.disconnect(),
        this.producer?.disconnect(),
      ]);
    }
  }
}
