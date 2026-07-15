import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { CortexMemorySearchManager } from './manager.mjs';

const scopedConfig = {
  tenantId: 'tenant-test',
  workspaceId: 'workspace-test',
  scopeCredentialId: 'manager-test',
  scopeHmacSecret: 'scope-test-secret',
  sessionIdentityHmacSecret: 'session-test-secret',
};

test('manager search attaches configured Cortex write authorization', async () => {
  const originalFetch = globalThis.fetch;
  let headers;
  globalThis.fetch = async (_url, options) => {
    headers = new Headers(options?.headers);
    return new Response('{"results":[]}');
  };
  try {
    const manager = await CortexMemorySearchManager.create({
      cfg: { ...scopedConfig, retryCount: 0, writeToken: 'manager-secret', writeTokenHeader: 'x-manager-token' },
      agentId: 'authorization-test',
    });
    await manager.search('authorized search');
    assert.equal(headers.get('x-manager-token'), 'manager-secret');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent declared-size rejections do not await body cancellation', async () => {
  const originalFetch = globalThis.fetch;
  const releases = [];
  let cancellations = 0;
  globalThis.fetch = async () => ({
    ok: true,
    headers: new Headers({ 'content-length': '65' }),
    body: {
      async cancel() {
        cancellations += 1;
        await new Promise((resolve) => { releases.push(resolve); });
      },
      getReader() { throw new Error('oversized response body must not be read'); },
    },
  });

  try {
    const manager = await CortexMemorySearchManager.create({
      cfg: { ...scopedConfig, maxResponseBytes: 64, retryCount: 0 },
      agentId: 'size-limit-test',
    });
    const searches = Array.from({ length: 8 }, (_, index) => manager.search(`oversized-${index}`));
    const results = Promise.allSettled(searches);
    let settled = false;
    results.then(() => { settled = true; });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancellations, searches.length, 'each response body is canceled');
    assert.equal(settled, true, 'search rejection is independent of stalled body cancellation');

    const outcomes = await results;
    for (const outcome of outcomes) {
      assert.equal(outcome.status, 'rejected');
      assert.match(outcome.reason.message, /response exceeds 64 bytes/);
    }
  } finally {
    for (const release of releases) release();
    globalThis.fetch = originalFetch;
  }
});

test('manager forwards signed tenant, workspace, and agent scope', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = { headers: new Headers(options?.headers), body: JSON.parse(String(options?.body)) };
    return new Response('{"results":[],"search_mode":"semantic","degraded":false}');
  };
  try {
    const manager = await CortexMemorySearchManager.create({
      cfg: scopedConfig,
      agentId: 'agent-a',
    });
    await manager.search('scoped search', { userId: 'user-a', sessionKey: 'session-a' });

    assert.deepEqual(request.body.scope, {
      tenant_id: 'tenant-test',
      workspace_id: 'workspace-test',
      agent_id: 'agent-a',
      user_id: 'user-a',
      channel_id: 'local-channel',
      session_id: `openclaw-${createHmac('sha256', 'session-test-secret').update('session-a').digest('hex')}`,
    });
    assert.equal(request.body.tenant_id, 'tenant-test');
    assert.equal(request.body.workspace_id, 'workspace-test');
    assert.match(request.body.scope_signature, /^[0-9a-f]{64}$/);
    assert.match(request.headers.get('x-cortex-scope-signature'), /^[0-9a-f]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manager fails closed when non-default memory scope lacks authentication', async () => {
  const manager = await CortexMemorySearchManager.create({
    cfg: { tenantId: 'tenant-a', workspaceId: 'workspace-a', sessionIdentityHmacSecret: 'session-test-secret' },
    agentId: 'agent-a',
  });
  await assert.rejects(() => manager.search('unscoped search'), /scopeCredentialId and scopeHmacSecret/);
});

test('manager rejects unkeyed session identity fallback', async () => {
  const manager = await CortexMemorySearchManager.create({
    cfg: { tenantId: 'cortex-local', workspaceId: 'default' },
    agentId: 'agent-a',
  });
  await assert.rejects(() => manager.search('local search'), /sessionIdentityHmacSecret is required/);
});

for (const response of [
  { results: [], search_mode: 'unavailable' },
  { results: [], error: 'librarian offline' },
]) {
  test(`manager rejects HTTP-200 unavailable search response ${JSON.stringify(response)}`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(response));
    try {
      const manager = await CortexMemorySearchManager.create({ cfg: scopedConfig, agentId: 'agent-a' });
      await assert.rejects(() => manager.search('availability test'), /Cortex memory search unavailable/);
      assert.equal((await manager.probeEmbeddingAvailability()).ok, false);
      assert.equal(await manager.probeVectorAvailability(), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test('manager accepts a degraded healthy fallback with no matching results', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    results: [],
    search_mode: 'lexical_fallback',
    degraded: true,
    available: true,
    warning: 'semantic provider unavailable; lexical fallback returned no match',
  }));
  try {
    const manager = await CortexMemorySearchManager.create({ cfg: scopedConfig, agentId: 'agent-a' });
    assert.deepEqual(await manager.search('clean empty fallback'), []);
    assert.equal((await manager.probeEmbeddingAvailability()).ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manager accepts degraded lexical recall when a backend returned results', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    degraded: true,
    search_mode: 'fallback_lexical',
    warning: 'semantic backend unavailable',
    results: [{ id: 'fallback-1', text: 'usable fallback memory', distance: 0.1, metadata: {} }],
  }));
  try {
    const manager = await CortexMemorySearchManager.create({ cfg: scopedConfig, agentId: 'agent-a' });
    const results = await manager.search('usable fallback');
    assert.equal(results.length, 1);
    assert.equal((await manager.probeEmbeddingAvailability()).ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
