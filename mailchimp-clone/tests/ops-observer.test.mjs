import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../apps/ops-observer/server.mjs';

test('ops observer shell exposes snapshot catalog', async () => {
  const server = createServer();
  const address = await server.start({ port: 0 });
  const baseUrl = 'http://127.0.0.1:' + address.port;
  try {
    const home = await fetch(baseUrl + '/');
    assert.match(await home.text(), /Ops Observer/);
    const catalog = await fetch(baseUrl + '/catalog.json');
    const payload = await catalog.json();
    assert.equal(payload.snapshots.length, 4);
  } finally {
    await server.stop();
  }
});
