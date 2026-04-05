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

test('expansion showcase exposes the long-horizon continuation inside the product shell', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Showcase Owner',
      email: 'showcase@example.com',
      password: 'secret123',
      workspaceName: 'Showcase Lab'
    }));

    const response = await request(baseUrl, jar, '/expansion-showcase');
    const html = await response.text();
    assert.match(html, /Expansion showcase/);
    assert.match(html, /Real browser proof recognition/);
    assert.match(html, /workspace-expansion-ledger/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
