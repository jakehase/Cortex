import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createAdminConsole } from '../apps/admin-console/server.mjs';
import { createServer as createDeveloperPortal } from '../apps/developer-portal/server.mjs';
import { createServer as createCustomerSuccess } from '../apps/customer-success/server.mjs';

async function check(createServer, expected) {
  const server = createServer();
  const address = await server.start({ port: 0 });
  const baseUrl = 'http://127.0.0.1:' + address.port;
  try {
    const home = await fetch(baseUrl + '/');
    assert.match(await home.text(), expected);
    const catalog = await fetch(baseUrl + '/catalog.json');
    const payload = await catalog.json();
    assert.ok(payload.routes.length >= 3);
  } finally {
    await server.stop();
  }
}

test('auxiliary app shells expose live catalog endpoints', async () => {
  await check(createAdminConsole, /Admin Console/);
  await check(createDeveloperPortal, /Developer Portal/);
  await check(createCustomerSuccess, /Customer Success Console/);
});
