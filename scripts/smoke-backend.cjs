// Real Kafka + MongoDB test; creates only isolated test topics/database, never deletes data.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { MongooseModule } = require('@nestjs/mongoose');
const { ValidationPipe } = require('@nestjs/common');
const { Kafka, logLevel } = require('kafkajs');
const { NotificationModule } = require('../dist/modules/notification/notification.module');
const { NotificationEventsModule } = require('../dist/modules/notification-events/notification-events.module');
const { GlobalExceptionFilter } = require('../dist/common/filters/global-exception.filter');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI for the integration test');
  const suffix = randomUUID();
  const topic = `homespace.notification.test.${suffix}`;
  const dlt = `${topic}.dlt`;
  const recipient = `test-${suffix}`;
  const secret = randomBytes(32).toString('hex');
  const config = {
    MONGODB_URI: process.env.MONGODB_URI,
    GATEWAY_INTERNAL_SECRET: secret,
    PUSH_ENABLED: false, NOTIFICATION_REALTIME_ENABLED: false,
    KAFKA_ENABLED: true, KAFKA_BROKERS: process.env.KAFKA_BROKERS || 'localhost:9092',
    KAFKA_CLIENT_ID: `test-${suffix}`, KAFKA_GROUP_ID: `test-${suffix}`,
    KAFKA_EVENTS_TOPIC: topic, KAFKA_DLT_TOPIC: dlt,
    KAFKA_RETRY_ATTEMPTS: 3, KAFKA_RETRY_DELAY_MS: 100,
  };
  const kafka = new Kafka({ brokers: config.KAFKA_BROKERS.split(','), logLevel: logLevel.NOTHING });
  const admin = kafka.admin();
  const producer = kafka.producer({ allowAutoTopicCreation: false });
  let app;
  try {
    await admin.connect();
    await admin.createTopics({ topics: [topic, dlt].map(topic => ({ topic, numPartitions: 1, replicationFactor: 1 })) });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => config] }),
      MongooseModule.forRoot(config.MONGODB_URI, { dbName: 'homespace_notification_test', serverSelectionTimeoutMS: 5000 }),
      NotificationModule, NotificationEventsModule,
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const headers = { 'content-type': 'application/json', 'x-internal-secret': secret, 'x-user-id': recipient };
    async function call(path, method = 'GET', body, user = recipient, expected = 200) {
      const response = await fetch(`${base}${path}`, { method, headers: { ...headers, 'x-user-id': user }, body: body === undefined ? undefined : JSON.stringify(body) });
      assert.equal(response.status, expected, `${method} ${path}`);
      return response.json();
    }
    assert.equal((await fetch(`${base}/feed`, { headers: { 'x-user-id': recipient } })).status, 401);
    await producer.connect();
    const event = { version: 1, eventId: `event-${suffix}`, eventType: 'LISTING_APPROVED', occurredAt: new Date().toISOString(), recipients: [recipient], data: { listingId: 'test-listing' } };
    await producer.send({ topic, messages: [{ key: recipient, value: JSON.stringify(event) }, { key: recipient, value: JSON.stringify(event) }] });
    let items = [];
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      items = (await call('/feed')).result.items;
      if (items.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(items.length, 1, 'Kafka notification persisted');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal((await call('/feed')).result.items.length, 1, 'duplicate event deduplicated');
    assert.equal((await call('/unread-count')).result.count, 1);
    const id = items[0].id;
    await call(`/${id}/read`, 'PATCH', undefined, 'other-user', 404);
    await call(`/${id}`, 'DELETE', undefined, 'other-user', 404);
    await call(`/${id}/read`, 'PATCH');
    assert.equal((await call('/unread-count')).result.count, 0);
    await call('/read-all', 'PATCH');
    await call('/feed?limit=0', 'GET', undefined, recipient, 400);
    await call('/feed?cursor=invalid', 'GET', undefined, recipient, 400);
    await call('/preferences', 'PUT', { items: [{ category: 'LISTING', push: false, email: false }] });
    assert.equal((await call('/preferences')).result.items.find(item => item.category === 'LISTING').push, false);
    const device = { installationId: randomUUID(), installationSecret: randomBytes(32).toString('base64url'), fid: `c${randomBytes(16).toString('base64url').slice(0,21)}` };
    await call('/devices', 'PUT', device);
    await call(`/devices/${device.installationId}`, 'DELETE', { installationSecret: device.installationSecret });
    await call(`/${id}`, 'DELETE');
    assert.equal((await call('/feed')).result.items.length, 0);
    const listingId = randomUUID();
    const listingCases = [
      ['LISTING_CREATED', {}], ['LISTING_UPDATED', {}],
      ['LISTING_APPROVED', {}], ['LISTING_REJECTED', {}],
      ['LISTING_EDIT_APPROVED', { editId: randomUUID() }],
      ['LISTING_EDIT_REJECTED', { editId: randomUUID() }],
      ['LISTING_EXPIRED', {}],
      ...['PENDING_REVIEW', 'HIDDEN', 'VIOLATION', 'RENTED_EXTERNALLY']
        .map(status => ['LISTING_STATUS_CHANGED', { status }]),
    ];
    const listingEvents = listingCases.map(([eventType, extra]) => ({
      version: 1, eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(),
      recipients: [recipient], data: { listingId, ...extra,
        ...(['LISTING_APPROVED', 'LISTING_REJECTED'].includes(eventType) ? {} : { listingTitle: 'Tin thu nghiem' }) },
    }));
    await producer.send({ topic, acks: -1, messages: listingEvents.flatMap(event => {
      const message = { key: listingId, value: JSON.stringify(event) };
      return [message, message];
    }) });
    let listingRows = [];
    const listingDeadline = Date.now() + 30000;
    while (Date.now() < listingDeadline) {
      listingRows = (await call('/feed?category=LISTING&limit=50')).result.items;
      if (listingRows.length === listingCases.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(listingRows.length, listingCases.length, 'all 11 listing decision/status cases persisted once');
    assert.equal(new Set(listingRows.map(row => row.id)).size, listingCases.length);
    for (const [eventType, extra] of listingCases) {
      const matches = listingRows.filter(row => row.type === eventType && row.metadata.status === extra.status);
      assert.equal(matches.length, 1, `${eventType} ${extra.status || ''}: exactly one notification`);
      const row = matches[0];
      assert.deepEqual(row.metadata, { listingId, ...extra });
      assert.equal(row.actionPath, `/dashboard/properties/view?id=${listingId}`);
      assert.equal(row.category, 'LISTING');
      assert.equal(row.priority, 'NORMAL');
      assert.equal(row.readAt, null);
      assert.equal(Object.hasOwn(row, 'recipientId'), false);
      assert.equal(Object.hasOwn(row, 'sourceEventId'), false);
      if (!['LISTING_APPROVED', 'LISTING_REJECTED'].includes(eventType)) assert.match(row.body, /Tin thu nghiem/);
    }
    assert.equal((await call('/unread-count')).result.count, listingCases.length);
    const bookingId = randomUUID();
    const renter = `renter-${suffix}`;
    const bookingTypes = [
      'BOOKING_REQUESTED', 'BOOKING_CONFIRMED', 'BOOKING_REJECTED',
      'BOOKING_RESCHEDULE_REQUESTED', 'BOOKING_RESCHEDULE_APPROVED',
      'BOOKING_RESCHEDULE_REJECTED', 'BOOKING_CANCELLED',
      'BOOKING_COMPLETED', 'BOOKING_EXPIRED',
    ];
    const bookings = bookingTypes.flatMap(eventType => ['OWNER', 'RENTER'].map(recipientSide => ({
      version: 1, eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(),
      recipients: [recipientSide === 'OWNER' ? recipient : renter],
      data: { bookingId, recipientSide, listingTitle: 'Can ho thu nghiem', appointmentDate: '2026-11-16', startTime: '08:00' },
    })));
    await producer.send({ topic, acks: -1, messages: bookings.flatMap(event => {
      const message = { key: bookingId, value: JSON.stringify(event) };
      return [message, message];
    }) });
    const bookingDeadline = Date.now() + 30000;
    let ownerBookings = [], renterBookings = [];
    while (Date.now() < bookingDeadline) {
      ownerBookings = (await call('/feed?category=APPOINTMENT&limit=50')).result.items;
      renterBookings = (await call('/feed?category=APPOINTMENT&limit=50', 'GET', undefined, renter)).result.items;
      if (ownerBookings.length === bookingTypes.length && renterBookings.length === bookingTypes.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    for (const [side, rows, path] of [
      ['OWNER', ownerBookings, '/dashboard/viewing-schedules'],
      ['RENTER', renterBookings, '/dashboard/viewing-schedules/my-bookings'],
    ]) {
      assert.equal(rows.length, bookingTypes.length, `${side}: all booking transitions persisted once`);
      assert.deepEqual(rows.map(row => row.type).sort(), [...bookingTypes].sort());
      for (const row of rows) {
        assert.equal(row.metadata.bookingId, bookingId);
        assert.equal(row.actionPath, `${path}?appointmentId=${bookingId}`);
        assert.match(row.body, /Can ho thu nghiem/);
        assert.match(row.body, /16\/11\/2026 lúc 08:00/);
      }
    }
    assert.equal((await call('/feed', 'GET', undefined, 'other-user')).result.items.length, 0);
    const requestId = randomUUID();
    const rentalTypes = [
      'RENTAL_REQUEST_SUBMITTED', 'RENTAL_REQUEST_ACCEPTED', 'RENTAL_REQUEST_REJECTED', 'RENTAL_REQUEST_AUTO_REJECTED',
      'RENTAL_REQUEST_CANCELLED', 'RENTAL_REQUEST_EXPIRED', 'RENTAL_HOLD_EXPIRED',
      'RENTAL_CANCELLATION_REQUESTED', 'RENTAL_CANCELLATION_REFUND_PENDING', 'RENTAL_CANCELLATION_REJECTED',
      'RENTAL_CANCELLATION_WITHDRAWN', 'RENTAL_CANCELLATION_DISPUTED',
      'RENTAL_START_CHANGE_REQUESTED', 'RENTAL_START_CHANGE_APPROVED', 'RENTAL_START_CHANGE_REJECTED',
      'RENTAL_START_CHANGE_WITHDRAWN', 'RENTAL_START_CHANGE_EXPIRED',
      'RENTAL_SIGNING_WINDOW_REOPENED', 'RENTAL_HOLD_EXTENDED', 'RENTAL_DEFAULT_NOTICE_ISSUED',
      'RENTAL_DEFAULT_DISPUTED', 'RENTAL_REQUEST_CANCELLED_BY_SYSTEM', 'RENTAL_RESUME_REQUESTED',
      'RENTAL_RESUMED', 'RENTAL_RESUME_REJECTED', 'RENTAL_RESUME_WITHDRAWN',
    ];
    const rentals = rentalTypes.flatMap(eventType => ['OWNER', 'RENTER'].map(recipientSide => ({
      version: 1, eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(),
      recipients: [recipientSide === 'OWNER' ? recipient : renter],
      data: { requestId, recipientSide, listingTitle: 'Yeu cau thue thu nghiem' },
    })));
    await producer.send({ topic, acks: -1, messages: rentals.flatMap(event => {
      const message = { key: requestId, value: JSON.stringify(event) };
      return [message, message];
    }) });
    let ownerRentals = [], renterRentals = [];
    const rentalDeadline = Date.now() + 30000;
    while (Date.now() < rentalDeadline) {
      ownerRentals = (await call('/feed?category=RENTAL_REQUEST&limit=50')).result.items;
      renterRentals = (await call('/feed?category=RENTAL_REQUEST&limit=50', 'GET', undefined, renter)).result.items;
      if (ownerRentals.length === rentalTypes.length && renterRentals.length === rentalTypes.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    for (const [side, rows, path] of [
      ['OWNER', ownerRentals, '/dashboard/rental-requests'],
      ['RENTER', renterRentals, '/dashboard/rental-requests/my-requests'],
    ]) {
      assert.equal(rows.length, rentalTypes.length, `${side}: all 26 rental types persisted once`);
      assert.deepEqual(rows.map(row => row.type).sort(), [...rentalTypes].sort());
      for (const row of rows) {
        assert.deepEqual(row.metadata, { requestId, recipientSide: side });
        assert.equal(row.actionPath, `${path}?requestId=${requestId}`);
        assert.match(row.body, /Yeu cau thue thu nghiem/);
        assert.equal(Object.hasOwn(row, 'recipientId'), false);
      }
    }
    assert.equal((await call('/preferences')).result.items.find(item => item.category === 'RENTAL_REQUEST').push, true);
    await call('/preferences', 'PUT', { items: [{ category: 'RENTAL_REQUEST', push: false, email: false }] });
    assert.equal((await call('/preferences')).result.items.find(item => item.category === 'RENTAL_REQUEST').push, false);
    assert.equal((await call('/feed', 'GET', undefined, 'other-user')).result.items.length, 0);
    console.log('PASS real Kafka -> MongoDB -> REST: persistence, dedupe, authorization, read/delete, validation, preferences, device registration');
    console.log('PASS booking: 9 event types x 2 recipient sides, duplicate replay, detail routes, recipient isolation');
    console.log('PASS listing: 8 event types, all 4 status values, legacy id-only events, duplicate replay, minimal metadata and owner routes');
    console.log('PASS rental request: 26 event types x 2 sides, replay dedupe, fixed routes, recipient isolation and category preferences');
    console.log('Test data retained only in homespace_notification_test; isolated Kafka topics use homespace.notification.test.*');
  } finally {
    await app?.close();
    await producer.disconnect();
    await admin.disconnect();
  }
}
main().catch(() => { console.error('Backend smoke failed; check service connectivity/configuration (secret values suppressed)'); process.exitCode = 1; });
