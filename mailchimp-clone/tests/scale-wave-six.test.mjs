import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

test('scale wave six route exposes the generated expansion families inside the product shell', async () => {
  const dir = createTempDataDir('wave6-scale-');
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  const baseUrl = 'http://127.0.0.1:' + address.port;
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Wave Six Owner',
      email: 'wave6@example.com',
      password: 'secret123',
      workspaceName: 'Wave Six Lab'
    }));
    const response = await request(baseUrl, jar, '/scale-wave-six');
    const html = await response.text();
    assert.match(html, /Scale Wave Six/);
    assert.match(html, /Attribution Modeling/);
    assert.match(html, /Webhook Inspector/);
    assert.match(html, /Lifecycle Studio/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});

