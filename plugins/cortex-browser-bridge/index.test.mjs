import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

import plugin, { requestText } from './index.ts';

const manifest = JSON.parse(await readFile(new URL('./openclaw.plugin.json', import.meta.url), 'utf8'));
const runtimeSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function statusTool(pluginConfig) {
  let tool;
  plugin.register({
    pluginConfig,
    registerTool(factory, options) {
      if (options.names.includes('cortex_browser_status')) tool = factory();
    },
  });
  assert.ok(tool);
  return tool;
}

function browseTool(pluginConfig) {
  let tool;
  plugin.register({
    pluginConfig,
    registerTool(factory, options) {
      if (options.names.includes('cortex_browse')) tool = factory();
    },
  });
  assert.ok(tool);
  return tool;
}

async function executeStatus(pluginConfig) {
  return JSON.parse(await statusTool(pluginConfig).execute());
}

test('config schema exposes the bounded response-size option and rejects unknown options', () => {
  assert.equal(manifest.configSchema.additionalProperties, false);
  assert.deepEqual(manifest.configSchema.properties.maxResponseBytes, {
    type: 'number',
    minimum: 1_024,
    maximum: 16_777_216,
    default: 1_048_576,
  });
  assert.match(runtimeSource, /maxResponseBytes: typeof c\.maxResponseBytes === 'number' \? c\.maxResponseBytes : 1_048_576/);
  assert.equal('maxResponseByte' in manifest.configSchema.properties, false);
});

test('status preserves a successful HTTP status and parsed body', async t => {
  const server = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"available":true}');
  });
  t.after(server.close);

  assert.deepEqual(await executeStatus({ baseUrl: server.baseUrl }), {
    ok: true,
    status: 200,
    body: { available: true },
  });
});

test('browser POST attaches the configured write-token header while status GET does not', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response('{}', { status: 200 });
  };
  try {
    const config = { baseUrl: 'http://bridge.invalid', writeToken: 'browser-secret', writeTokenHeader: 'x-browser-token' };
    await browseTool(config).execute('call', { query: 'test' });
    await executeStatus(config);
    assert.equal(new Headers(requests[0].init.headers).get('x-browser-token'), 'browser-secret');
    assert.equal(new Headers(requests[1].init.headers).has('x-browser-token'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const status of [404, 503]) {
  test(`status preserves bounded diagnostic body for HTTP ${status}`, async t => {
    const diagnostic = `diagnostic-${status}`;
    const server = await listen((_req, res) => {
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(diagnostic);
    });
    t.after(server.close);

    assert.deepEqual(await executeStatus({ baseUrl: server.baseUrl, maxResponseBytes: 64 }), {
      ok: false,
      status,
      body: diagnostic,
    });
  });
}

test('status reports an oversize response as an established bounded-read failure', async t => {
  const server = await listen((_req, res) => {
    res.writeHead(200);
    res.write('x'.repeat(32));
    res.end('x'.repeat(33));
  });
  t.after(server.close);

  assert.deepEqual(await executeStatus({ baseUrl: server.baseUrl, maxResponseBytes: 64 }), {
    ok: false,
    error: 'response exceeds 64 bytes',
  });
});

test('declared oversize responses do not await stalled body cancellation', async () => {
  const originalFetch = globalThis.fetch;
  let cancellations = 0;
  let nextResponse = 0;
  globalThis.fetch = async () => {
    const responseNumber = nextResponse++;
    return new Response(new ReadableStream({
      cancel() {
        cancellations += 1;
        if (responseNumber === 0) return new Promise(() => {});
      },
    }), { headers: { 'content-length': '65' } });
  };

  try {
    const results = await Promise.allSettled(Array.from(
      { length: 8 },
      () => requestText('http://bridge.invalid/status', { method: 'GET' }, 1_000, 64),
    ));
    assert.equal(cancellations, 8);
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason?.message, 'response exceeds 64 bytes');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamed oversize responses do not await stalled reader cancellation', async () => {
  const originalFetch = globalThis.fetch;
  let cancellationAttempted = false;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader() {
        return {
          async read() { return { done: false, value: new Uint8Array(65) }; },
          cancel() { cancellationAttempted = true; return new Promise(() => {}); },
        };
      },
    },
  });
  try {
    await assert.rejects(
      requestText('http://bridge.invalid/status', { method: 'GET' }, 1_000, 64),
      /response exceeds 64 bytes/,
    );
    assert.equal(cancellationAttempted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('status reports a deadline failure', async t => {
  const server = await listen(() => {});
  t.after(server.close);

  const result = await executeStatus({ baseUrl: server.baseUrl, timeoutMs: 20 });
  assert.equal(result.ok, false);
  assert.match(result.error, /abort/i);
});

test('status reports a network failure', async () => {
  const server = await listen((_req, res) => res.end());
  const baseUrl = server.baseUrl;
  await server.close();

  const result = await executeStatus({ baseUrl, timeoutMs: 200 });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0);
  assert.equal('status' in result, false);
  assert.equal('body' in result, false);
});
