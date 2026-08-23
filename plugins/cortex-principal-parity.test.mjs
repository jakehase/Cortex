import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import registerRouteGate from './cortex-route-gate/index.ts';
import memoryBridge from './cortex-memory-bridge/index.ts';

const PRINCIPAL_HEADERS = [
  'x-cortex-tenant-id',
  'x-cortex-workspace-id',
  'x-cortex-agent-id',
  'x-cortex-user-id',
  'x-cortex-channel-id',
  'x-cortex-session-id',
  'x-cortex-scope-credential-id',
  'x-cortex-scope-signature',
];

function principalHeaders(init) {
  const headers = new Headers(init?.headers);
  return Object.fromEntries(PRINCIPAL_HEADERS.map((name) => [name, headers.get(name)]));
}

function createParityHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-principal-parity-'));
  const routeHandlers = new Map();
  let memorySearchFactory;
  const common = {
    baseUrl: 'http://cortex.invalid',
    tenantId: 'tenant-parity',
    workspaceId: 'workspace-parity',
    agentId: 'configured-agent',
    userId: 'configured-user',
    channelId: 'configured-channel',
    // Runtime code must remain safe if legacy configuration bypasses schema
    // validation during a rolling upgrade.
    preferConfiguredUserId: true,
    sessionIdentityHmacSecret: 'principal-parity-session-secret',
    scopeCredentialId: 'principal-parity-credential',
    scopeHmacSecret: 'principal-parity-scope-secret',
    writeToken: 'principal-parity-write-token',
  };

  registerRouteGate({
    config: {
      ...common,
      enabled: true,
      requireRouting: true,
      stateDir: path.join(root, 'route'),
    },
    logger: { info() {}, warn() {} },
    on(name, handler) { routeHandlers.set(name, handler); },
  });
  memoryBridge.register({
    pluginConfig: {
      ...common,
      enabledCodecContinuity: false,
      enabledWriteThrough: false,
      retryCount: 0,
      stateDir: path.join(root, 'memory'),
    },
    logger: { info() {}, warn() {} },
    on() {},
    registerMemoryRuntime() {},
    registerTool(factory, options) {
      if (options?.names?.includes('memory_search')) memorySearchFactory = factory;
    },
  });

  assert.equal(typeof routeHandlers.get('before_prompt_build'), 'function');
  assert.equal(typeof memorySearchFactory, 'function');
  return {
    root,
    async invoke(context, suffix) {
      const requests = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        requests.push({ pathname, principal: principalHeaders(init) });
        if (pathname === '/nexus/orchestrate') {
          return new Response(JSON.stringify({
            success: true,
            recommended_levels: [{ level: 24, name: 'Nexus' }],
            routing_method: 'principal_parity_regression',
            reasoning: ['Route and memory principal headers must remain identical.'],
            routing_markers: {},
            contract: { contract_version: 'orchestrate_guard_v3' },
          }));
        }
        if (pathname === '/knowledge/search') {
          return new Response('{"results":[],"search_mode":"semantic"}');
        }
        throw new Error(`unexpected parity endpoint: ${pathname}`);
      };
      try {
        await routeHandlers.get('before_prompt_build')(
          {
            prompt: `principal parity ${suffix}`,
            messages: [{ role: 'user', content: `principal parity ${suffix}` }],
          },
          context,
        );
        const memoryResult = JSON.parse(await memorySearchFactory(context).execute(
          `memory-${suffix}`,
          { query: `principal parity ${suffix}` },
        ));
        assert.equal(memoryResult.disabled, undefined);
      } finally {
        globalThis.fetch = originalFetch;
      }
      return {
        route: requests.find((request) => request.pathname === '/nexus/orchestrate')?.principal,
        memory: requests.find((request) => request.pathname === '/knowledge/search')?.principal,
      };
    },
    close() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('route and memory plugins derive the same callback-first principal', async () => {
  const harness = createParityHarness();
  const context = {
    sessionKey: 'shared-parity-session',
    agentId: 'runtime-agent',
    userId: 'runtime-user',
    channelId: 'runtime-channel',
  };
  try {
    const observed = await harness.invoke(context, 'same-callback');
    const sessionId = `openclaw-${createHmac('sha256', 'principal-parity-session-secret')
      .update(context.sessionKey)
      .digest('hex')}`;
    assert.deepEqual(observed.route, observed.memory);
    assert.deepEqual(observed.route, {
      'x-cortex-tenant-id': 'tenant-parity',
      'x-cortex-workspace-id': 'workspace-parity',
      'x-cortex-agent-id': 'runtime-agent',
      'x-cortex-user-id': 'runtime-user',
      'x-cortex-channel-id': 'runtime-channel',
      'x-cortex-session-id': sessionId,
      'x-cortex-scope-credential-id': 'principal-parity-credential',
      'x-cortex-scope-signature': observed.route['x-cortex-scope-signature'],
    });
    assert.match(observed.route['x-cortex-scope-signature'], /^[0-9a-f]{64}$/);
  } finally {
    harness.close();
  }
});

test('distinct callback users sharing one session never share route or memory principal state', async () => {
  const harness = createParityHarness();
  const baseContext = {
    sessionKey: 'colliding-raw-session',
    agentId: 'runtime-agent',
    channelId: 'runtime-channel',
  };
  try {
    const alpha = await harness.invoke({ ...baseContext, userId: 'runtime-user-alpha' }, 'alpha');
    const beta = await harness.invoke({ ...baseContext, userId: 'runtime-user-beta' }, 'beta');

    assert.deepEqual(alpha.route, alpha.memory);
    assert.deepEqual(beta.route, beta.memory);
    assert.equal(alpha.route['x-cortex-user-id'], 'runtime-user-alpha');
    assert.equal(beta.route['x-cortex-user-id'], 'runtime-user-beta');
    assert.notEqual(alpha.route['x-cortex-scope-signature'], beta.route['x-cortex-scope-signature']);
    assert.equal(
      fs.readdirSync(path.join(harness.root, 'route', 'principals'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory()).length,
      2,
    );
  } finally {
    harness.close();
  }
});

test('route and memory plugins apply identical configured fallbacks to partial callbacks', async () => {
  const harness = createParityHarness();
  const context = { sessionKey: 'partial-callback-session' };
  try {
    const observed = await harness.invoke(context, 'partial-callback');
    assert.deepEqual(observed.route, observed.memory);
    assert.equal(observed.route['x-cortex-agent-id'], 'configured-agent');
    assert.equal(observed.route['x-cortex-user-id'], 'configured-user');
    assert.equal(observed.route['x-cortex-channel-id'], 'configured-channel');
    assert.match(observed.route['x-cortex-session-id'], /^openclaw-[0-9a-f]{64}$/);
  } finally {
    harness.close();
  }
});
