import test from 'node:test';
import assert from 'node:assert/strict';

import plugin from './index.ts';

const LOOPBACK = 'http://127.0.0.1:18888';
const SECURE_CONFIG = {
  baseUrl: LOOPBACK,
  maxAttempts: 2,
  writeToken: 'browser-transport-token',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agentId: 'agent-a',
  userId: 'user-a',
  channelId: 'channel-a',
  scopeCredentialId: 'browser-credential',
  scopeHmacSecret: 'browser-principal-secret-00000001',
  sessionIdentityHmacSecret: 'browser-session-secret-000000001',
};
const TRUSTED_CONTEXT = {
  sessionKey: 'browser-session-a',
  userId: 'user-a',
  channelId: 'channel-a',
  agentId: 'agent-a',
};

function tools(config = {}) {
  const registered = new Map();
  plugin.register({
    pluginConfig: { ...SECURE_CONFIG, ...config },
    registerTool(factory, options) {
      for (const name of options.names) registered.set(name, factory(TRUSTED_CONTEXT));
    },
  });
  return registered;
}

async function withFetch(fake, operation) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await operation(); } finally { globalThis.fetch = original; }
}

test('BROWSER-1 status returns bounded local response metadata', async () => {
  const calls = [];
  const result = await withFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('{"available":true}', { status: 200 });
  }, async () => JSON.parse(await tools().get('cortex_browser_status').execute()));
  assert.deepEqual(result, { ok: true, status: 200, attempts: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${LOOPBACK}/browser/status`);
  assert.equal(calls[0].init.method, 'GET');
});

test('BROWSER-1 search response preserves parsed result rows', async () => {
  const calls = [];
  const upstream = [{ title: 'Local fixture', link: 'https://public.example/page' }];
  const result = await withFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(upstream), { status: 200 });
  }, async () => JSON.parse(await tools().get('cortex_browse').execute('call', {
    query: 'local fixture query',
    maxResults: 3,
  })));
  assert.deepEqual(result, {
    ok: true,
    provider: 'cortex-browser',
    endpoint: '/browser/search',
    attempts: 1,
    data: upstream,
  });
  assert.equal(calls[0].url, `${LOOPBACK}/browser/search`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    query: 'local fixture query',
    max_results: 3,
    include_content: true,
  });
});

test('BROWSER-1 exact-page response stays on the local bridge and preserves text', async () => {
  const calls = [];
  const exactUrl = 'https://public.example/exact-page';
  const result = await withFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify('Exact local fixture page'), { status: 200 });
  }, async () => JSON.parse(await tools().get('cortex_browse').execute('call', {
    query: 'exact page',
    url: exactUrl,
  })));
  assert.equal(result.ok, true);
  assert.equal(result.endpoint, '/browser/browse');
  assert.equal(result.data, 'Exact local fixture page');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${LOOPBACK}/browser/browse`);
  assert.equal(JSON.parse(calls[0].init.body).url, exactUrl);
  assert.notEqual(calls[0].url, exactUrl);
});

test('BROWSER-1 retries only to its bound and emits an unattempted fallback contract', async () => {
  let calls = 0;
  const result = await withFetch(async () => {
    calls += 1;
    return new Response('synthetic unavailable', { status: 503 });
  }, async () => JSON.parse(await tools({ maxAttempts: 2 }).get('cortex_browse').execute('call', {
    query: 'bounded retry',
  })));
  assert.equal(calls, 2);
  assert.deepEqual(result, {
    ok: false,
    provider: 'cortex-browser',
    endpoint: '/browser/search',
    status: 503,
    attempts: 2,
    error: 'Cortex browser request failed',
    fallback: {
      required: true,
      attempted: false,
      reason: 'cortex_browser_unavailable',
    },
  });
});

test('BROWSER-1 rejects non-loopback bridge egress before fetch or credentials', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    throw new Error('fetch must not run');
  }, async () => {
    assert.throws(
      () => tools({ baseUrl: 'https://external.example' }),
      /credential-free loopback HTTP origin/,
    );
  });
  assert.equal(calls, 0);
});
