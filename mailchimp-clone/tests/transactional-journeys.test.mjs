import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('transactional journeys support creation, activation, and sample dispatches', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Journey Admin',
      email: 'journeys@example.com',
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
