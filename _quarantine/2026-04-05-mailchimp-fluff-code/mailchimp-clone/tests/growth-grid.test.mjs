import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../apps/growth-grid/server.mjs';

test('growth-grid shell exposes a live catalog for the scale-wave-seven domains', async () => {
  const server = createServer();
  const address = await server.start({ port: 0 });
  const baseUrl = 'http://127.0.0.1:' + address.port;
  try {
    const home = await fetch(baseUrl + '/');
    assert.match(await home.text(), /Growth Grid/);
    const catalog = await fetch(baseUrl + '/catalog.json');
    const payload = await catalog.json();
    assert.ok(payload.groupCount >= 1);
    assert.ok(payload.moduleCount >= 1);
  } finally {
    await server.stop();
  }
});

