import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import {
  TRANSACTIONAL_MESSAGING_RUNTIME_CONTRACT,
  buildTransactionalRuntimeSnapshot,
  createTransactionalJourney,
  dispatchTransactionalJourney,
  persistTransactionalRuntimeSnapshot,
  recordTransactionalSuppressionEvent,
  recordTransactionalWebhookEvent,
  retryTransactionalDelivery,
  setJourneyStatus
} from '../packages/customer-journeys/index.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('transactional messaging runtime builds trigger, render, delivery, retry, suppression, webhook, and snapshot evidence', () => {
  const state = {
    db: {
      transactionalJourneys: [],
      transactionalDeliveries: [],
      transactionalRuntimeSnapshots: [],
      transactionalTriggerEvents: [],
      transactionalRenderEvents: [],
      transactionalDeliveryAttempts: [],
      transactionalSuppressionEvents: [],
      transactionalWebhookEvents: []
    }
  };
  const actor = { workspace: { id: 'ws_1' }, user: { id: 'user_1' } };
  assert.equal(TRANSACTIONAL_MESSAGING_RUNTIME_CONTRACT.surfaceId, 'transactional_messaging_delivery_runtime_layer');
  const journey = createTransactionalJourney(state, actor, {
    name: 'Order confirmation',
    trigger: 'order_created',
    channel: 'email',
    template: 'Order {{orderId}} confirmation'
  });
  setJourneyStatus(journey, 'live');
  const delivered = dispatchTransactionalJourney(state, actor, journey, {
    recipient: 'buyer@example.com',
    eventKey: 'order_created',
    payload: '{"orderId":"123"}'
  });
  recordTransactionalSuppressionEvent(state, actor, journey, { recipient: 'optout@example.com', reason: 'recipient_opted_out' });
  const suppressed = dispatchTransactionalJourney(state, actor, journey, {
    recipient: 'optout@example.com',
    eventKey: 'order_created',
    payload: '{"orderId":"456"}'
  });
  retryTransactionalDelivery(state, actor, journey, delivered, { responseCode: '202' });
  recordTransactionalWebhookEvent(state, actor, journey, { provider: 'mailclone_provider', eventType: 'delivered', messageId: 'msg_123', recipient: 'buyer@example.com', payload: '{"status":"delivered"}' });
  const snapshot = persistTransactionalRuntimeSnapshot(state, actor, 'test_snapshot');

  assert.equal(delivered.status, 'delivered');
  assert.equal(suppressed.status, 'suppressed');
  assert.equal(snapshot.triggerEventCount, 2);
  assert.equal(snapshot.renderEventCount, 2);
  assert.equal(snapshot.deliveryAttemptCount, 3);
  assert.equal(snapshot.suppressionEventCount, 1);
  assert.equal(snapshot.webhookEventCount, 1);
  assert.equal(snapshot.countsByStatus.delivered, 1);
  assert.equal(snapshot.countsByStatus.suppressed, 1);
  assert.ok(snapshot.evidenceContract.includes('delivery_attempts_and_retries'));
  assert.match(snapshot.recentRenderEvents[0].renderedPreview, /Order 456 confirmation|Order 123 confirmation/);
});

test('transactional messaging runtime routes persist attempts, suppression, webhook, snapshot, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Transactional Runtime Admin',
      email: 'transactional-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Transactional Runtime Lab'
    }));

    await postForm(baseUrl, jar, '/journeys/transactional', {
      name: 'Order confirmation',
      trigger: 'order_created',
      channel: 'email',
      template: 'Order {{orderId}} confirmation'
    });
    const journey = server.state.db.transactionalJourneys[0];
    await postForm(baseUrl, jar, `/journeys/transactional/${journey.id}/status`, { status: 'live' });
    await postForm(baseUrl, jar, `/journeys/transactional/${journey.id}/dispatch`, {
      recipient: 'buyer@example.com',
      eventKey: 'order_created',
      payload: '{"orderId":"123"}'
    });
    const delivered = server.state.db.transactionalDeliveries.find((entry) => entry.recipient === 'buyer@example.com');
    await postForm(baseUrl, jar, `/journeys/transactional/${journey.id}/deliveries/${delivered.id}/retry`, {});
    await postForm(baseUrl, jar, `/journeys/transactional/${journey.id}/suppression`, { recipient: 'optout@example.com', reason: 'recipient_opted_out' });
    await postForm(baseUrl, jar, `/journeys/transactional/${journey.id}/dispatch`, {
      recipient: 'optout@example.com',
      eventKey: 'order_created',
      payload: '{"orderId":"456"}'
    });
    await postForm(baseUrl, jar, `/journeys/transactional/${journey.id}/webhook`, {
      provider: 'mailclone_provider',
      eventType: 'delivered',
      messageId: 'msg_123',
      recipient: 'buyer@example.com',
      payload: '{"status":"delivered"}'
    });
    await postForm(baseUrl, jar, '/journeys/transactional/runtime/snapshot', {});

    assert.equal(server.state.db.transactionalTriggerEvents.length, 2);
    assert.equal(server.state.db.transactionalRenderEvents.length, 2);
    assert.equal(server.state.db.transactionalDeliveryAttempts.length, 3);
    assert.equal(server.state.db.transactionalSuppressionEvents.length, 1);
    assert.equal(server.state.db.transactionalWebhookEvents.length, 1);
    assert.equal(server.state.db.transactionalRuntimeSnapshots.length, 1);
    assert.equal(server.state.db.transactionalDeliveries.find((entry) => entry.recipient === 'optout@example.com').status, 'suppressed');

    const api = await request(baseUrl, jar, '/api/journeys/transactional/runtime');
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.transactionalRuntime.surfaceId, 'transactional_messaging_delivery_runtime_layer');
    assert.equal(payload.transactionalRuntime.triggerEventCount, 2);
    assert.equal(payload.transactionalRuntime.renderEventCount, 2);
    assert.equal(payload.transactionalRuntime.deliveryAttemptCount, 3);
    assert.equal(payload.transactionalRuntime.suppressionEventCount, 1);
    assert.equal(payload.transactionalRuntime.webhookEventCount, 1);

    const overview = await (await request(baseUrl, jar, '/journeys/transactional')).text();
    assert.match(overview, /Open transactional runtime API/);
    assert.match(overview, /delivery attempts/i);
    assert.match(overview, /suppressions/i);

    const detail = await (await request(baseUrl, jar, `/journeys/transactional/${journey.id}`)).text();
    assert.match(detail, /Runtime operations/);
    assert.match(detail, /Retry delivery/);
    assert.match(detail, /optout@example.com/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});

test('existing transactional journey creation, activation, and dispatch flow remains supported', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Journey Admin',
      email: 'journeys-existing@example.com',
      password: 'secret123',
      workspaceName: 'Journey Lab'
    }));

    await postForm(baseUrl, jar, '/journeys/transactional', {
      name: 'Order confirmation',
      trigger: 'order_created',
      channel: 'email',
      template: 'Order confirmation'
    });

    const journey = server.state.db.transactionalJourneys[0];
    await postForm(baseUrl, jar, `/journeys/transactional/${journey.id}/status`, { status: 'live' });
    await postForm(baseUrl, jar, `/journeys/transactional/${journey.id}/dispatch`, {
      recipient: 'buyer@example.com',
      eventKey: 'order_created',
      payload: '{"orderId":"123"}'
    });

    const page = await request(baseUrl, jar, `/journeys/transactional/${journey.id}`);
    const html = await page.text();
    assert.match(html, /buyer@example.com/);
    assert.match(html, /Status: live/);
    assert.equal(server.state.db.transactionalDeliveries[0].status, 'delivered');
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
