// Real Kafka + MongoDB test; creates only isolated test topics/database, never deletes data.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { createHash, randomUUID, randomBytes } = require('node:crypto');
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
  const dltReader = kafka.consumer({ groupId: `test-dlt-${suffix}`, allowAutoTopicCreation: false });
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
    const accountTypes = ['ACCOUNT_ROLE_CHANGED', 'ACCOUNT_DISABLED', 'ACCOUNT_ENABLED'];
    const accountEvents = accountTypes.map(eventType => ({ version: 1, eventId: randomUUID(), eventType,
      occurredAt: new Date().toISOString(), recipients: [recipient], data: {} }));
    await producer.send({ topic, acks: -1, messages: accountEvents.flatMap(event => {
      const message = { key: recipient, value: JSON.stringify(event) };
      return [message, message];
    }) });
    let accountRows = [];
    const accountDeadline = Date.now() + 30000;
    while (Date.now() < accountDeadline) {
      accountRows = (await call('/feed?category=ACCOUNT')).result.items;
      if (accountRows.length === accountTypes.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.deepEqual(accountRows.map(row => row.type).sort(), [...accountTypes].sort());
    for (const row of accountRows) {
      assert.equal(row.actionPath, '/settings/account-security'); assert.equal(row.metadata, null);
      await call(`/${row.id}/read`, 'PATCH', undefined, 'other-user', 404);
      await call(`/${row.id}`, 'DELETE', undefined, 'other-user', 404);
    }
    assert.equal((await call('/feed?category=ACCOUNT', 'GET', undefined, renter)).result.items.length, 0);
    const membershipOrderId = randomUUID().replaceAll('-', '');
    const membershipTypes = ['MEMBERSHIP_ACTIVATED', 'MEMBERSHIP_PAYMENT_REVIEW'];
    await producer.send({ topic, acks: -1, messages: membershipTypes.flatMap(eventType => {
      const event = { version: 1, eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(),
        recipients: [recipient], data: { orderId: membershipOrderId } };
      const message = { key: membershipOrderId, value: JSON.stringify(event) };
      return [message, message];
    }) });
    let membershipRows = [];
    const membershipDeadline = Date.now() + 30000;
    while (Date.now() < membershipDeadline) {
      membershipRows = (await call('/feed?category=PAYMENT')).result.items;
      if (membershipRows.length === 2) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.deepEqual(membershipRows.map(row => row.type).sort(), [...membershipTypes].sort());
    for (const row of membershipRows) {
      assert.deepEqual(row.metadata, { orderId: membershipOrderId });
      assert.equal(row.actionPath, `/dashboard/membership/return?orderId=${membershipOrderId}`);
      await call(`/${row.id}/read`, 'PATCH', undefined, 'other-user', 404);
    }
    const paymentId = randomUUID();
    const paymentTypes = ['PAYMENT_REQUEST_CREATED', 'PAYMENT_TRANSFER_REPORTED', 'PAYMENT_RECEIPT_CONFIRMED', 'PAYMENT_RECEIPT_REJECTED',
      'PAYMENT_DISPUTE_OPENED', 'PAYMENT_DISPUTE_EVIDENCE_ADDED', 'PAYMENT_DISPUTE_PROPOSED', 'PAYMENT_DISPUTE_PROPOSAL_DECLINED',
      'PAYMENT_DISPUTE_ESCALATED', 'PAYMENT_DISPUTE_REVIEW_TRANSFER', 'PAYMENT_DISPUTE_REOPENED'];
    const paymentRecipient = `payment-${suffix}`;
    await producer.send({ topic, acks: -1, messages: paymentTypes.flatMap(eventType => {
      const event = { version: 1, eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(),
        recipients: [paymentRecipient], data: { paymentId } };
      const message = { key: paymentId, value: JSON.stringify(event) };
      return [message, message];
    }) });
    let paymentRows = [];
    const paymentDeadline = Date.now() + 30000;
    while (Date.now() < paymentDeadline) {
      paymentRows = (await call('/feed?category=PAYMENT', 'GET', undefined, paymentRecipient)).result.items;
      if (paymentRows.length === paymentTypes.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.deepEqual(paymentRows.map(row => row.type).sort(), [...paymentTypes].sort());
    for (const row of paymentRows) {
      assert.deepEqual(row.metadata, { paymentId });
      assert.equal(row.actionPath, `/dashboard/payments?paymentId=${paymentId}`);
      await call(`/${row.id}/read`, 'PATCH', undefined, 'other-user', 404);
      await call(`/${row.id}`, 'DELETE', undefined, 'other-user', 404);
    }
    await call('/preferences', 'PUT', { items: [{ category: 'PAYMENT', push: false, email: false }] }, paymentRecipient);
    assert.equal((await call('/feed?category=PAYMENT', 'GET', undefined, paymentRecipient)).result.items.length, paymentTypes.length);
    assert.equal((await call('/feed?category=PAYMENT', 'GET', undefined, renter)).result.items.length, 0);
    const invoiceTypes = ['INVOICE_DRAFT_READY', 'INVOICE_ISSUED', 'INVOICE_OVERDUE', 'INVOICE_AMOUNT_UPDATED', 'INVOICE_EXTENSION_REQUESTED',
      'INVOICE_EXTENSION_APPROVED', 'INVOICE_EXTENSION_REJECTED', 'INVOICE_EXTENSION_EXPIRED', 'INVOICE_OVERDUE_ACTION_RECORDED',
      'INVOICE_OVERDUE_ACTION_ACKNOWLEDGED', 'INVOICE_DEFERRED', 'INVOICE_ROLLED_OVER', 'INVOICE_OVERDUE_ACTION_REQUIRED'];
    const invoiceContractId = randomUUID(), invoiceId = randomUUID();
    const invoiceRecipient = `invoice-${suffix}`;
    await producer.send({ topic, acks: -1, messages: invoiceTypes.flatMap(eventType => {
      const event = { version: 1, eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(),
        recipients: [invoiceRecipient], data: { contractId: invoiceContractId, invoiceId } };
      const message = { key: invoiceId, value: JSON.stringify(event) };
      return [message, message];
    }) });
    let invoiceRows = [];
    const invoiceDeadline = Date.now() + 30000;
    while (Date.now() < invoiceDeadline) {
      invoiceRows = (await call('/feed?category=PAYMENT&limit=50', 'GET', undefined, invoiceRecipient)).result.items;
      if (invoiceRows.length === invoiceTypes.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.deepEqual(invoiceRows.map(row => row.type).sort(), [...invoiceTypes].sort(), '13 invoice outcomes persisted once');
    for (const row of invoiceRows) {
      assert.deepEqual(row.metadata, { contractId: invoiceContractId, invoiceId });
      assert.equal(row.actionPath, `/dashboard/invoices/${invoiceContractId}?section=monthly&invoice=${invoiceId}`);
      assert.equal(row.category, 'PAYMENT'); assert.equal(row.priority, 'NORMAL');
      assert.equal(Object.hasOwn(row, 'recipientId'), false);
      await call(`/${row.id}/read`, 'PATCH', undefined, 'other-user', 404);
      await call(`/${row.id}`, 'DELETE', undefined, 'other-user', 404);
    }
    await call('/preferences', 'PUT', { items: [{ category: 'PAYMENT', push: false, email: false }] }, invoiceRecipient);
    assert.equal((await call('/feed?category=PAYMENT&limit=50', 'GET', undefined, invoiceRecipient)).result.items.length, invoiceTypes.length);
    assert.equal((await call('/feed?category=PAYMENT', 'GET', undefined, renter)).result.items.length, 0);
    assert.equal((await call('/feed?category=PAYMENT&limit=50', 'GET', undefined, paymentRecipient)).result.items.filter(row => row.type.startsWith('INVOICE_')).length, 0);
    const agreementKinds = ['LEASE', 'DEPOSIT', 'AMENDMENT', 'RENEWAL', 'EARLY_EXIT'];
    const agreementTypes = ['AGREEMENT_REVIEW_READY', 'AGREEMENT_SIGNING_TURN', 'AGREEMENT_FULLY_SIGNED', 'AGREEMENT_SIGNATURE_NEEDS_REVIEW'];
    const agreementRecipient = `agreement-${suffix}`;
    const agreementIds = Object.fromEntries(agreementKinds.map(kind => [kind, randomUUID()]));
    const agreementEvents = agreementTypes.flatMap(eventType => agreementKinds
      .map(kind => ({ version: 1, eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(),
        recipients: [agreementRecipient], data: { agreementId: agreementIds[kind], agreementKind: kind } })));
    // Invalid shapes go through the same topic: unknown kinds must never persist.
    const agreementInvalid = [['AGREEMENT_SIGNING_TURN', 'UNKNOWN'], ['AGREEMENT_REVIEW_READY', 'UNKNOWN'], ['AGREEMENT_REVIEW_READY', 'MOVE_IN']].map(([eventType, kind]) => ({
      version: 1, eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(),
      recipients: [agreementRecipient], data: { agreementId: randomUUID(), agreementKind: kind } }));
    await producer.send({ topic, acks: -1, messages: [...agreementInvalid, ...agreementEvents].flatMap(event => {
      const message = { key: event.data.agreementId, value: JSON.stringify(event) };
      return [message, message];
    }) });
    let agreementRows = [];
    const agreementDeadline = Date.now() + 30000;
    while (Date.now() < agreementDeadline) {
      agreementRows = (await call('/feed?category=CONTRACT&limit=50', 'GET', undefined, agreementRecipient)).result.items;
      if (agreementRows.length === agreementEvents.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(agreementRows.length, agreementEvents.length, `${agreementEvents.length} agreement outcomes persisted once`);
    assert.deepEqual(agreementRows.map(row => `${row.type}/${row.metadata.agreementKind}`).sort(),
      agreementEvents.map(event => `${event.eventType}/${event.data.agreementKind}`).sort());
    for (const row of agreementRows) {
      const { agreementKind } = row.metadata;
      assert.deepEqual(row.metadata, { agreementId: agreementIds[agreementKind], agreementKind });
      assert.equal(row.actionPath, `/dashboard/contracts/${agreementIds[agreementKind]}`);
      assert.equal(row.category, 'CONTRACT'); assert.equal(row.priority, 'NORMAL');
      assert.equal(Object.hasOwn(row, 'recipientId'), false);
      await call(`/${row.id}/read`, 'PATCH', undefined, 'other-user', 404);
      await call(`/${row.id}`, 'DELETE', undefined, 'other-user', 404);
    }
    await call('/preferences', 'PUT', { items: [{ category: 'CONTRACT', push: false, email: false }] }, agreementRecipient);
    assert.equal((await call('/feed?category=CONTRACT&limit=50', 'GET', undefined, agreementRecipient)).result.items.length, agreementEvents.length);
    assert.equal((await call('/feed?category=CONTRACT&limit=50', 'GET', undefined, invoiceRecipient)).result.items.filter(row => row.type.startsWith('AGREEMENT_')).length, 0);
    const amendmentTypes = ['AMENDMENT_RESPONSE_NEEDED', 'AMENDMENT_DECIDED', 'AMENDMENT_WITHDRAWN', 'AMENDMENT_EXPIRED', 'AMENDMENT_APPLIED'];
    const amendmentContractId = randomUUID(), amendmentRecipient = `amendment-${suffix}`;
    await producer.send({ topic, acks: -1, messages: amendmentTypes.flatMap(eventType => {
      const event = { version: 1, eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(),
        recipients: [amendmentRecipient], data: { contractId: amendmentContractId } };
      const message = { key: amendmentContractId, value: JSON.stringify(event) };
      return [message, message];
    }) });
    let amendmentRows = [];
    const amendmentDeadline = Date.now() + 30000;
    while (Date.now() < amendmentDeadline) {
      amendmentRows = (await call('/feed?category=CONTRACT&limit=50', 'GET', undefined, amendmentRecipient)).result.items;
      if (amendmentRows.length === amendmentTypes.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.deepEqual(amendmentRows.map(row => row.type).sort(), [...amendmentTypes].sort(), '5 amendment outcomes persisted once');
    for (const row of amendmentRows) {
      assert.deepEqual(row.metadata, { contractId: amendmentContractId });
      assert.equal(row.actionPath, `/dashboard/contracts/${amendmentContractId}`);
      assert.equal(row.category, 'CONTRACT');
      await call(`/${row.id}`, 'DELETE', undefined, 'other-user', 404);
    }
    assert.equal((await call('/feed?category=CONTRACT&limit=50', 'GET', undefined, agreementRecipient)).result.items.filter(row => row.type.startsWith('AMENDMENT_')).length, 0);
    console.log('PASS amendments: 5 outcomes, replay dedupe, fixed root route, exact metadata and recipient isolation');
    const renewalTypes = ['RENEWAL_REQUESTED', 'RENEWAL_APPROVED', 'RENEWAL_REJECTED', 'RENEWAL_EXPIRED'];
    const renewalContractId = randomUUID(), renewalRecipient = `renewal-${suffix}`;
    await producer.send({ topic, acks: -1, messages: renewalTypes.flatMap(eventType => {
      const event = { version: 1, eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(),
        recipients: [renewalRecipient], data: { contractId: renewalContractId } };
      const message = { key: renewalContractId, value: JSON.stringify(event) };
      return [message, message];
    }) });
    let renewalRows = [];
    const renewalDeadline = Date.now() + 30000;
    while (Date.now() < renewalDeadline) {
      renewalRows = (await call('/feed?category=CONTRACT&limit=50', 'GET', undefined, renewalRecipient)).result.items;
      if (renewalRows.length === renewalTypes.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.deepEqual(renewalRows.map(row => row.type).sort(), [...renewalTypes].sort(), '4 renewal outcomes persisted once');
    for (const row of renewalRows) {
      assert.deepEqual(row.metadata, { contractId: renewalContractId });
      assert.equal(row.actionPath, `/dashboard/contracts/${renewalContractId}`);
      assert.equal(row.category, 'CONTRACT');
      await call(`/${row.id}`, 'DELETE', undefined, 'other-user', 404);
    }
    assert.equal((await call('/feed?category=CONTRACT&limit=50', 'GET', undefined, agreementRecipient)).result.items.filter(row => row.type.startsWith('RENEWAL_')).length, 0);
    console.log('PASS renewals: 4 outcomes, replay dedupe, fixed root route, exact metadata and recipient isolation');
    const terminationTypes = ['TERMINATION_RESPONSE_NEEDED', 'TERMINATION_AGREED', 'TERMINATION_DECLINED', 'TERMINATION_WITHDRAWN',
      'TERMINATION_NOTICE_ISSUED', 'TERMINATION_REVIEW_REQUESTED', 'TERMINATION_REVIEW_APPROVED',
      'TERMINATION_NOTICE_CANCELLED', 'TERMINATION_ENDED', 'LEASE_EXPIRED'];
    const terminationContractId = randomUUID(), terminationRecipient = `termination-${suffix}`;
    await producer.send({ topic, acks: -1, messages: terminationTypes.flatMap(eventType => {
      const event = { version: 1, eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(),
        recipients: [terminationRecipient], data: { contractId: terminationContractId } };
      const message = { key: terminationContractId, value: JSON.stringify(event) };
      return [message, message];
    }) });
    let terminationRows = [];
    const terminationDeadline = Date.now() + 30000;
    while (Date.now() < terminationDeadline) {
      terminationRows = (await call('/feed?category=CONTRACT&limit=50', 'GET', undefined, terminationRecipient)).result.items;
      if (terminationRows.length === terminationTypes.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.deepEqual(terminationRows.map(row => row.type).sort(), [...terminationTypes].sort(), '10 termination outcomes persisted once');
    for (const row of terminationRows) {
      assert.deepEqual(row.metadata, { contractId: terminationContractId });
      assert.equal(row.actionPath, `/dashboard/contracts/${terminationContractId}`);
      assert.equal(row.category, 'CONTRACT');
      await call(`/${row.id}`, 'DELETE', undefined, 'other-user', 404);
    }
    console.log('PASS terminations: 10 outcomes, replay dedupe, fixed root route, exact metadata and recipient isolation');
    const settlementTypes = ['LEASE_RETURN_CONFIRMED', 'LEASE_RETURN_COMPLETED', 'SETTLEMENT_RESPONSE_NEEDED',
      'SETTLEMENT_DISPUTED', 'SETTLEMENT_PROPOSAL_INVALIDATED', 'SETTLEMENT_AGREED',
      'SETTLEMENT_RESPONSE_OVERDUE', 'SETTLEMENT_PAYMENT_OVERDUE', 'LEASE_CLOSED', 'PAYMENT_OBLIGATION_OVERDUE'];
    const settlementRoot = randomUUID(), obligationId = randomUUID(), settlementRecipient = `settlement-${suffix}`;
    await call('/preferences', 'PUT', { items: ['CONTRACT', 'PAYMENT'].map(category => ({ category, push: false, email: false })) }, settlementRecipient);
    const settlementEvents = settlementTypes.map(eventType => ({ version: 1, eventId: randomUUID(), eventType,
      occurredAt: new Date().toISOString(), recipients: [settlementRecipient],
      data: eventType === 'PAYMENT_OBLIGATION_OVERDUE' ? { paymentId: obligationId } : { contractId: settlementRoot } }));
    const settlementInvalid = settlementEvents.map(event => ({ ...event, eventId: randomUUID(), data: { ...event.data, reason: 'PRIVATE_SETTLEMENT_REASON' } }));
    settlementInvalid.push({ ...settlementEvents[0], eventId: randomUUID(), recipients: [settlementRecipient, 'other-user'] },
      { ...settlementEvents[0], eventId: randomUUID(), data: { paymentId: obligationId } },
      { ...settlementEvents.at(-1), eventId: randomUUID(), data: { contractId: settlementRoot } });
    const dltRecords = [];
    await dltReader.connect();
    await dltReader.subscribe({ topic: dlt, fromBeginning: true });
    await dltReader.run({ eachMessage: async ({ message }) => { dltRecords.push(JSON.parse(message.value.toString('utf8'))); } });
    await producer.send({ topic, acks: -1, messages: [...settlementInvalid, ...settlementEvents].flatMap(event => {
      const message = { key: event.data.contractId || event.data.paymentId, value: JSON.stringify(event) };
      return [message, message];
    }) });
    let settlementRows = [];
    const settlementDeadline = Date.now() + 30000;
    while (Date.now() < settlementDeadline) {
      settlementRows = (await call('/feed?limit=50', 'GET', undefined, settlementRecipient)).result.items;
      if (settlementRows.length === settlementEvents.length) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.deepEqual(settlementRows.map(row => row.type).sort(), [...settlementTypes].sort(), '10 return/settlement/deadline outcomes persisted once');
    for (const row of settlementRows) {
      const monetary = row.type === 'PAYMENT_OBLIGATION_OVERDUE';
      const physicalReturn = ['LEASE_RETURN_CONFIRMED', 'LEASE_RETURN_COMPLETED'].includes(row.type);
      assert.deepEqual(row.metadata, monetary ? { paymentId: obligationId } : { contractId: settlementRoot });
      assert.equal(row.actionPath, monetary ? `/dashboard/payments?paymentId=${obligationId}`
        : physicalReturn ? `/dashboard/contracts/${settlementRoot}` : `/dashboard/invoices/${settlementRoot}?section=deposit`);
      assert.equal(row.category, monetary ? 'PAYMENT' : 'CONTRACT'); assert.equal(row.priority, 'NORMAL');
      assert.equal(Object.hasOwn(row, 'recipientId'), false);
      await call(`/${row.id}/read`, 'PATCH', undefined, 'other-user', 404);
      await call(`/${row.id}`, 'DELETE', undefined, 'other-user', 404);
    }
    assert.equal((await call('/feed?category=CONTRACT&limit=50', 'GET', undefined, settlementRecipient)).result.items.length, 9);
    assert.equal((await call('/feed?category=PAYMENT', 'GET', undefined, settlementRecipient)).result.items.length, 1);
    assert.equal((await call('/feed?limit=50', 'GET', undefined, 'other-user')).result.items.length, 0);
    const settlementPreferences = (await call('/preferences', 'GET', undefined, settlementRecipient)).result.items;
    for (const category of ['CONTRACT', 'PAYMENT']) assert.deepEqual(settlementPreferences.find(item => item.category === category), { category, push: false, email: false });
    const invalidHashes = settlementInvalid.map(event => createHash('sha256').update(JSON.stringify(event)).digest('hex'));
    const dltDeadline = Date.now() + 30000;
    while (Date.now() < dltDeadline && invalidHashes.some(hash => !dltRecords.some(record => record.payloadSha256 === hash))) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    for (const hash of invalidHashes) {
      const record = dltRecords.find(item => item.payloadSha256 === hash);
      assert.ok(record, 'invalid settlement payload reached the DLT');
      assert.deepEqual(Object.keys(record).sort(), ['payloadSha256', 'reason', 'source', 'version']);
      assert.equal(record.version, 1); assert.equal(record.reason, 'INVALID_EVENT');
      assert.deepEqual(Object.keys(record.source).sort(), ['offset', 'partition', 'topic']);
      assert.equal(record.source.topic, topic); assert.equal(record.source.partition, 0);
      assert.match(record.source.offset, /^\d+$/);
      assert.ok(!JSON.stringify(record).includes(settlementRecipient));
      assert.ok(!JSON.stringify(record).includes(settlementRoot));
      assert.ok(!JSON.stringify(record).includes(obligationId));
      assert.ok(!JSON.stringify(record).includes('PRIVATE_SETTLEMENT_REASON'));
    }
    console.log('PASS return/settlement: 9 root outcomes + obligation overdue, replay dedupe, fixed routes, exact metadata, authorization, disabled preferences and 13 invalid payloads in redacted DLT');
    console.log(`PASS agreement signing: 4 types x allowed kinds (${agreementEvents.length} events), replay dedupe, unknown-kind rejection, fixed routes, exact metadata and recipient isolation`);
    console.log('PASS invoices: 13 outcomes, replay dedupe, fixed monthly route, exact metadata, recipient isolation and PAYMENT preference');
    console.log('PASS payments: 11 outcomes, replay dedupe, authorized common routes and recipient isolation');
    console.log('PASS membership: 2 verified outcomes, replay dedupe, owner routes and no private provider data');
    console.log('PASS account: 3 committed event types, empty data, fixed own-account path, replay dedupe and ownership');
    console.log('PASS real Kafka -> MongoDB -> REST: persistence, dedupe, authorization, read/delete, validation, preferences, device registration');
    console.log('PASS booking: 9 event types x 2 recipient sides, duplicate replay, detail routes, recipient isolation');
    console.log('PASS listing: 8 event types, all 4 status values, legacy id-only events, duplicate replay, minimal metadata and owner routes');
    console.log('PASS rental request: 26 event types x 2 sides, replay dedupe, fixed routes, recipient isolation and category preferences');
    console.log('Test data retained only in homespace_notification_test; isolated Kafka topics use homespace.notification.test.*');
  } finally {
    await app?.close();
    await dltReader.disconnect();
    await producer.disconnect();
    await admin.disconnect();
  }
}
main().catch(() => { console.error('Backend smoke failed; check service connectivity/configuration (secret values suppressed)'); process.exitCode = 1; });
