import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

test('parity route aliases redirect to the canonical Mailclone surfaces', async () => {
  const dataDir = createTempDataDir('mailclone-parity-route-aliases-');
  process.env.MAILCLONE_DATA_DIR = dataDir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const jar = new CookieJar();

  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Alias Admin',
      email: 'alias@example.com',
      password: 'secret123',
      workspaceName: 'Alias Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const dashboardAlias = await request(baseUrl, jar, '/dashboard', { redirect: 'manual' });
    assert.equal(dashboardAlias.status, 302);
    assert.equal(dashboardAlias.headers.get('location'), '/app');

    const audienceAlias = await request(baseUrl, jar, '/audience', { redirect: 'manual' });
    assert.equal(audienceAlias.status, 302);
    assert.equal(audienceAlias.headers.get('location'), '/audiences');

    const audienceCanonical = await request(baseUrl, jar, '/audiences');
    const audienceHtml = await audienceCanonical.text();
    assert.equal(audienceCanonical.status, 200);
    assert.match(audienceHtml, /Audience overview/i);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
