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

test('mobile app companion pairs devices, queues offline actions, and syncs them', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Mobile Admin',
      email: 'mobile@example.com',
      password: 'secret123',
      workspaceName: 'Mobile Lab'
    }));

    const landing = await request(baseUrl, jar, '/mobile-app');
    assert.match(await landing.text(), /Mobile app command center/);

    await postForm(baseUrl, jar, '/mobile-app/sessions', {
      deviceName: "Jake's iPhone",
      platform: 'ios',
      pushOptIn: 'on'
    });

    const session = server.state.db.mobileAppSessions[0];
    assert.equal(session.deviceName, "Jake's iPhone");
    assert.equal(session.pushOptIn, true);

    await postForm(baseUrl, jar, `/mobile-app/sessions/${session.id}/actions`, {
      kind: 'inbox_reply',
      target: 'riley@example.com',
      payload: '{"body":"Reply drafted from phone"}'
    });
    assert.equal(server.state.db.mobileAppQueuedActions[0].status, 'queued');

    await postForm(baseUrl, jar, `/mobile-app/sessions/${session.id}/sync`, {});
    assert.equal(server.state.db.mobileAppQueuedActions[0].status, 'synced');
    assert.match(server.state.db.mobileAppSessions[0].lastSyncSummary, /Synced 1 queued actions/);

    const page = await request(baseUrl, jar, `/mobile-app/sessions/${session.id}`);
    const html = await page.text();
    assert.match(html, /Jake&#39;s iPhone|Jake&#x27;s iPhone|Jake's iPhone/);
    assert.match(html, /synced/);
    assert.match(html, /Reply drafted from phone/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
