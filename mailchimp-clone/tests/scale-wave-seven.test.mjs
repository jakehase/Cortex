import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

test('scale wave seven route exposes the 500k campaign expansion inside the product shell', async () => {
  const dir = createTempDataDir('wave7-scale-');
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  const baseUrl = 'http://127.0.0.1:' + address.port;
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Wave Seven Owner',
      email: 'wave7@example.com',
      password: 'secret123',
      workspaceName: 'Wave Seven Lab'
    }));
    const response = await request(baseUrl, jar, '/scale-wave-seven');
    const html = await response.text();
    assert.match(html, /Scale Wave Seven/);
    assert.match(html, /Total modules:/);
    assert.match(html, /Growth Grid/);
    assert.match(html, /Lifecycle Network/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});

