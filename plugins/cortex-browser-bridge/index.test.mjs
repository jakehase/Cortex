import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';

import plugin, { requestText } from './index.ts';

const manifest = JSON.parse(await readFile(new URL('./openclaw.plugin.json', import.meta.url), 'utf8'));
const runtimeSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
const SECURE_CONFIG = {
  writeToken: 'browser-transport-token',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agentId: 'configured-agent-a',
  userId: 'configured-user-a',
  channelId: 'configured-channel-a',
  scopeCredentialId: 'browser-credential',
  scopeHmacSecret: 'browser-principal-secret-00000001',
  sessionIdentityHmacSecret: 'browser-session-secret-000000001',
};
const TRUSTED_CONTEXT = {
  sessionKey: 'callback-session-a',
  userId: 'callback-user-a',
  channelId: 'callback-channel-a',
  agentId: 'callback-agent-a',
};

function statusTool(pluginConfig) {
  let tool;
  plugin.register({
    pluginConfig: { ...SECURE_CONFIG, ...(pluginConfig || {}) },
    registerTool(factory, options) {
      if (options.names.includes('cortex_browser_status')) tool = factory(TRUSTED_CONTEXT);
    },
  });
  assert.ok(tool);
  return tool;
}

function browseTool(pluginConfig, trustedContext = TRUSTED_CONTEXT) {
  let tool;
  plugin.register({
    pluginConfig: { ...SECURE_CONFIG, ...(pluginConfig || {}) },
    registerTool(factory, options) {
      if (options.names.includes('cortex_browse')) tool = factory(trustedContext);
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
  assert.deepEqual(
    new Set(manifest.configSchema.required),
    new Set([
      'writeToken',
      'tenantId',
      'workspaceId',
      'agentId',
      'userId',
      'channelId',
      'scopeCredentialId',
      'scopeHmacSecret',
      'sessionIdentityHmacSecret',
    ]),
  );
});

test('registration fails closed without the scoped action credential', () => {
  assert.throws(
    () => plugin.register({ pluginConfig: {}, registerTool() {} }),
    /requires writeToken.*agentId.*userId.*channelId.*scopeCredentialId.*scopeHmacSecret.*sessionIdentityHmacSecret/,
  );
});

test('status preserves a successful HTTP status without forwarding the upstream body', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"available":true}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    assert.deepEqual(await executeStatus({ baseUrl: 'http://bridge.invalid' }), {
      ok: true,
      status: 200,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    assert.equal(new Headers(requests[0].init.headers).get('x-cortex-user-id'), 'callback-user-a');
    assert.match(new Headers(requests[0].init.headers).get('x-cortex-action-signature'), /^[0-9a-f]{64}$/);
    assert.equal(new Headers(requests[1].init.headers).has('x-browser-token'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('browser tools do not forward upstream diagnostic bodies', async () => {
  const originalFetch = globalThis.fetch;
  const opaqueDiagnostic = 'OPAQUE_UPSTREAM_SECRET_123456789';
  globalThis.fetch = async () => new Response(opaqueDiagnostic, { status: 503 });
  try {
    const result = await browseTool({ baseUrl: 'http://bridge.invalid' })
      .execute('call', { query: 'bounded failure' });
    assert.equal(result.includes(opaqueDiagnostic), false);
    assert.deepEqual(JSON.parse(result), {
      ok: false,
      provider: 'cortex-browser',
      endpoint: '/browser/search',
      status: 503,
      error: 'Cortex browser request failed',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('browser action signature binds callback principal, path, exact body, nonce, and expiry', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response('{}', { status: 200 });
  };
  try {
    await browseTool({ baseUrl: 'http://bridge.invalid' }).execute('call', { query: 'bound request' });
    const { init } = requests[0];
    const headers = new Headers(init.headers);
    const scope = ['tenant-id', 'workspace-id', 'agent-id', 'user-id', 'channel-id', 'session-id']
      .map((field) => headers.get(`x-cortex-${field}`));
    const principalId = [
      'role:principal',
      `credential:${headers.get('x-cortex-scope-credential-id')}`,
      ...['tenant_id', 'workspace_id', 'agent_id', 'user_id', 'channel_id', 'session_id']
        .map((field, index) => `${field}:${scope[index]}`),
    ].join('|');
    const canonical = [
      'cortex.action.capability.v1',
      principalId,
      'POST',
      '/browser/search',
      `sha256:${createHash('sha256').update(init.body, 'utf8').digest('hex')}`,
      headers.get('x-cortex-action-nonce'),
      headers.get('x-cortex-action-issued-at'),
      headers.get('x-cortex-action-expires-at'),
    ].join('\n');
    const expected = createHmac('sha256', SECURE_CONFIG.scopeHmacSecret).update(canonical, 'utf8').digest('hex');
    assert.equal(headers.get('x-cortex-action-signature'), expected);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('browser action applies configured principal fallbacks to a trusted session-only callback', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response('{}', { status: 200 });
  };
  try {
    await browseTool(
      { baseUrl: 'http://bridge.invalid' },
      { sessionKey: 'session-only-browser-callback' },
    ).execute('call', { query: 'fallback-bound request' });
    const headers = new Headers(request.init.headers);
    assert.equal(headers.get('x-cortex-agent-id'), SECURE_CONFIG.agentId);
    assert.equal(headers.get('x-cortex-user-id'), SECURE_CONFIG.userId);
    assert.equal(headers.get('x-cortex-channel-id'), SECURE_CONFIG.channelId);
    assert.equal(
      headers.get('x-cortex-session-id'),
      `openclaw-${createHmac('sha256', SECURE_CONFIG.sessionIdentityHmacSecret)
        .update('session-only-browser-callback', 'utf8')
        .digest('hex')}`,
    );
    assert.match(headers.get('x-cortex-action-signature'), /^[0-9a-f]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const status of [404, 503]) {
  test(`status does not forward diagnostic body for HTTP ${status}`, async () => {
    const originalFetch = globalThis.fetch;
    const diagnostic = `diagnostic-${status}`;
    globalThis.fetch = async () => new Response(diagnostic, {
      status,
      headers: { 'content-type': 'text/plain' },
    });
    try {
      assert.deepEqual(await executeStatus({ baseUrl: 'http://bridge.invalid', maxResponseBytes: 64 }), {
        ok: false,
        status,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test('status reports an oversize response as an established bounded-read failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('x'.repeat(65), { status: 200 });
  try {
    assert.deepEqual(await executeStatus({ baseUrl: 'http://bridge.invalid', maxResponseBytes: 64 }), {
      ok: false,
      error: 'response exceeds 64 bytes',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('status reports a metadata-only deadline failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  });
  try {
    assert.deepEqual(await executeStatus({ baseUrl: 'http://bridge.invalid', timeoutMs: 20 }), {
      ok: false,
      error: 'Cortex browser status request failed',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('status reports a network failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('synthetic network diagnostic'); };
  try {
    assert.deepEqual(await executeStatus({ baseUrl: 'http://bridge.invalid', timeoutMs: 200 }), {
      ok: false,
      error: 'Cortex browser status request failed',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
