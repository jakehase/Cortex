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
const managerParams = (cfg, identity = {}) => {
  const invocationContext = {
    sessionKey: 'manager-session',
    userId: 'manager-user',
    channelId: 'manager-channel',
    agentId: 'agent-a',
    ...identity,
  };
  return { cfg, agentId: invocationContext.agentId, invocationContext };
};

test('manager search attaches configured Cortex write authorization', async () => {
  const originalFetch = globalThis.fetch;
  let headers;
  globalThis.fetch = async (_url, options) => {
    headers = new Headers(options?.headers);
    return new Response('{"results":[]}');
  };
  try {
    const manager = await CortexMemorySearchManager.create(managerParams(
      { ...scopedConfig, retryCount: 0, writeToken: 'manager-secret', writeTokenHeader: 'x-manager-token' },
      { agentId: 'authorization-test' },
    ));
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
    const manager = await CortexMemorySearchManager.create(managerParams(
      { ...scopedConfig, maxResponseBytes: 64, retryCount: 0 },
      { agentId: 'size-limit-test' },
    ));
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
    const manager = await CortexMemorySearchManager.create(managerParams(scopedConfig, {
      sessionKey: 'session-a',
      userId: 'user-a',
      channelId: 'local-channel',
      agentId: 'agent-a',
    }));
    await manager.search('scoped search', { userId: 'model-controlled-user', sessionKey: 'model-controlled-session' });

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

test('legacy configured-user preference cannot override trusted runtime identity', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(String(options?.body));
    return new Response('{"results":[],"search_mode":"semantic","degraded":false}');
  };
  try {
    const manager = await CortexMemorySearchManager.create(managerParams(
      { ...scopedConfig, userId: 'configured-openclaw-user', preferConfiguredUserId: true },
      { userId: 'runtime-only-user' },
    ));
    await manager.search('callback principal remains authoritative');
    assert.equal(request.scope.user_id, 'runtime-only-user');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manager fails closed when non-default memory scope lacks authentication', async () => {
  const manager = await CortexMemorySearchManager.create(managerParams(
    { tenantId: 'tenant-a', workspaceId: 'workspace-a', sessionIdentityHmacSecret: 'session-test-secret' },
  ));
  await assert.rejects(() => manager.search('unscoped search'), /scopeCredentialId and scopeHmacSecret/);
});

test('manager fails closed for the default local scope when unsigned development is not enabled', async () => {
  const manager = await CortexMemorySearchManager.create(managerParams({
    sessionIdentityHmacSecret: 'session-test-secret',
    retryCount: 0,
  }));
  await assert.rejects(() => manager.search('default local search'), /scopeCredentialId and scopeHmacSecret/);
});

test('manager permits unsigned search only with the explicit local-development opt-in', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = { headers: new Headers(options?.headers), body: JSON.parse(String(options?.body || '{}')) };
    return new Response('{"results":[],"search_mode":"semantic"}');
  };
  try {
    const manager = await CortexMemorySearchManager.create(managerParams({
      sessionIdentityHmacSecret: 'session-test-secret',
      allowUnsignedLocalDevelopment: true,
      retryCount: 0,
    }));
    await manager.search('explicit unsigned local search');
    assert.equal(request.headers.get('x-cortex-tenant-id'), 'cortex-local');
    assert.equal(request.headers.get('x-cortex-workspace-id'), 'default');
    assert.equal(request.headers.has('x-cortex-scope-credential-id'), false);
    assert.equal(request.headers.has('x-cortex-scope-signature'), false);
    assert.equal('scope_credential_id' in request.body, false);
    assert.equal('scope_signature' in request.body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manager rejects unkeyed session identity fallback', async () => {
  const manager = await CortexMemorySearchManager.create(managerParams(
    { tenantId: 'cortex-local', workspaceId: 'default' },
  ));
  await assert.rejects(() => manager.search('local search'), /sessionIdentityHmacSecret is required/);
});

test('manager construction fails closed when its trusted invocation seam is incomplete', async () => {
  await assert.rejects(
    () => CortexMemorySearchManager.create({ cfg: scopedConfig, agentId: 'agent-a' }),
    /trusted invocation context: missing sessionKey/,
  );
});

test('manager applies configured fallbacks to a trusted session-only callback', async () => {
  let request;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(String(options?.body || '{}'));
    return new Response('{"results":[],"search_mode":"semantic"}');
  };
  try {
    const manager = await CortexMemorySearchManager.create({
      cfg: {
        ...scopedConfig,
        agentId: 'configured-agent',
        userId: 'configured-user',
        channelId: 'configured-channel',
        retryCount: 0,
      },
      invocationContext: { sessionKey: 'session-only-runtime' },
    });
    await manager.search('runtime fallback parity');
    assert.deepEqual(request.scope, {
      tenant_id: 'tenant-test',
      workspace_id: 'workspace-test',
      agent_id: 'configured-agent',
      user_id: 'configured-user',
      channel_id: 'configured-channel',
      session_id: `openclaw-${createHmac('sha256', 'session-test-secret').update('session-only-runtime').digest('hex')}`,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const response of [
  { results: [], search_mode: 'unavailable' },
  { results: [], error: 'librarian offline' },
]) {
  test(`manager rejects HTTP-200 unavailable search response ${JSON.stringify(response)}`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(response));
    try {
      const manager = await CortexMemorySearchManager.create(managerParams(scopedConfig));
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
    const manager = await CortexMemorySearchManager.create(managerParams(scopedConfig));
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
    const manager = await CortexMemorySearchManager.create(managerParams(scopedConfig));
    const results = await manager.search('usable fallback');
    assert.equal(results.length, 1);
    assert.equal((await manager.probeEmbeddingAvailability()).ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
