import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import registerRouteGate from './cortex-route-gate/index.ts';
import memoryBridge from './cortex-memory-bridge/index.ts';

const ROUTE_FIXTURE = JSON.parse(fs.readFileSync(
  new URL('./cortex-route-gate/nexus-orchestrate-response.fixture.json', import.meta.url),
  'utf8',
));
const SESSION_SECRET = 'shared-session-identity-secret-for-route-memory-repair-tests-2026';

function routeConfig(stateDir, overrides = {}) {
  return {
    enabled: true,
    requireRouting: true,
    baseUrl: 'http://127.0.0.1:18888',
    timeoutMs: 200,
    tenantId: 'tenant-repair',
    workspaceId: 'workspace-repair',
    agentId: 'main',
    userId: 'owner-user',
    ownerSenderId: 'owner-sender',
    channelId: 'whatsapp',
    sessionIdentityHmacSecret: SESSION_SECRET,
    scopeCredentialId: 'route-repair-test',
    scopeHmacSecret: 'route-repair-scope-secret',
    writeToken: 'route-repair-write-token',
    stateDir,
    oracleConsultEnabled: false,
    ...overrides,
  };
}

function memoryConfig(stateDir) {
  return {
    baseUrl: 'http://127.0.0.1:18888',
    tenantId: 'tenant-repair',
    workspaceId: 'workspace-repair',
    agentId: 'main',
    userId: 'owner-user',
    ownerSenderId: 'owner-sender',
    channelId: 'whatsapp',
    sessionIdentityHmacSecret: SESSION_SECRET,
    scopeCredentialId: 'memory-repair-test',
    scopeHmacSecret: 'memory-repair-scope-secret',
    writeToken: 'memory-repair-write-token',
    enabledWriteThrough: false,
    enabledCodecContinuity: true,
    retryCount: 0,
    timeoutMs: 500,
    lifecycleReplayInitialDelayMs: 600_000,
    lifecycleReplayRetryMs: 600_000,
    lifecycleReplaySuccessDelayMs: 600_000,
    stateDir,
  };
}

function registerRoute(config) {
  const handlers = new Map();
  registerRouteGate({
    pluginConfig: config,
    logger: { info() {}, warn() {} },
    on(name, handler) { handlers.set(name, handler); },
  });
  return handlers;
}

function registerMemory(config) {
  const handlers = new Map();
  memoryBridge.register({
    pluginConfig: config,
    logger: { info() {}, warn() {} },
    on(name, handler) { handlers.set(name, handler); },
    registerMemoryRuntime() {},
    registerTool() {},
  });
  return handlers;
}

function codecResponse(body) {
  const scope = body.scope;
  return new Response(JSON.stringify({
    success: true,
    acknowledgement: {
      version: 'nexus.codec-write-ack.v1',
      status: 'accepted',
      session_key: `principal:${createHash('sha256').update([
        'codec-session', scope.tenant_id, scope.workspace_id, scope.agent_id,
        scope.user_id, scope.channel_id, scope.session_id,
      ].join('\0')).digest('hex')}`,
      event_count: body.events.length,
      state_fingerprint: 'repair-smoke-codec-state',
    },
  }));
}

test('trusted native delegation routes and persists completion under its signed parent principal', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-memory-repair-'));
  const routeHandlers = registerRoute(routeConfig(path.join(stateDir, 'route')));
  const memoryHandlers = registerMemory(memoryConfig(path.join(stateDir, 'memory')));
  const routeRequests = [];
  const codecRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const requestPath = new URL(String(url)).pathname;
    const body = JSON.parse(String(options?.body || '{}'));
    if (requestPath === '/nexus/orchestrate') {
      routeRequests.push({ headers: new Headers(options?.headers), body });
      return new Response(JSON.stringify(ROUTE_FIXTURE));
    }
    if (requestPath === '/nexus/codec/events') {
      codecRequests.push({ headers: new Headers(options?.headers), body });
      return codecResponse(body);
    }
    throw new Error(`unexpected endpoint ${requestPath}`);
  };

  const parentSessionKey = 'agent:main:repair-parent';
  const childSessionKey = 'agent:research:repair-child';
  const parentContext = {
    sessionKey: parentSessionKey,
    runId: 'parent-run',
    senderId: 'owner-sender',
    channel: 'whatsapp',
    agentId: 'main',
  };
  const childContext = {
    sessionKey: childSessionKey,
    runId: 'child-run',
    agentId: 'research',
  };

  try {
    const ordinary = await routeHandlers.get('before_prompt_build')(
      { prompt: 'Route the ordinary owner turn.', messages: [{ role: 'user', content: 'Route the ordinary owner turn.' }] },
      parentContext,
    );
    assert.match(ordinary.appendSystemContext, /CORTEX_ROUTE_GATE/);

    const spawned = routeHandlers.get('subagent_spawning')(
      { childSessionKey, agentId: 'research', mode: 'run', threadRequested: false },
      { runId: 'child-run', childSessionKey, requesterSessionKey: parentSessionKey },
    );
    assert.deepEqual(spawned, { status: 'ok' });

    const delegated = await routeHandlers.get('before_prompt_build')(
      { prompt: 'Perform the delegated repair analysis.', messages: [{ role: 'user', content: 'Perform the delegated repair analysis.' }] },
      childContext,
    );
    assert.match(delegated.appendSystemContext, /CORTEX_ROUTE_GATE/);
    assert.equal(routeRequests.length, 2, 'ordinary and delegated turns both use Nexus routing');

    for (const header of ['x-cortex-tenant-id', 'x-cortex-workspace-id', 'x-cortex-agent-id', 'x-cortex-user-id', 'x-cortex-channel-id', 'x-cortex-session-id', 'x-session-id']) {
      assert.equal(routeRequests[1].headers.get(header), routeRequests[0].headers.get(header), `${header} is inherited from the authenticated parent`);
    }
    assert.equal(routeRequests[1].headers.get('x-cortex-agent-id'), 'main');
    assert.equal(routeRequests[1].headers.get('x-cortex-user-id'), 'owner-user');

    memoryHandlers.get('llm_output')(
      { assistantTexts: ['Delegated repair completed and the focused continuity result is ready.'] },
      childContext,
    );
    const outcome = await memoryHandlers.get('subagent_ended')(
      {
        targetSessionKey: childSessionKey,
        targetKind: 'subagent',
        reason: 'completed',
        runId: 'child-run',
        outcome: 'ok',
      },
      { runId: 'child-run', childSessionKey, requesterSessionKey: parentSessionKey },
    );
    assert.equal(outcome.ok, true);
    assert.equal(outcome.codecContinuity, 'succeeded');
    assert.equal(codecRequests.length, 1);
    assert.match(codecRequests[0].body.events[0].text, /Delegated repair completed/);
    assert.equal(codecRequests[0].body.scope.agent_id, 'main');
    assert.equal(codecRequests[0].body.scope.user_id, 'owner-user');
    assert.equal(codecRequests[0].body.scope.session_id, routeRequests[0].headers.get('x-cortex-session-id'));
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('missing and forged delegation evidence fails closed before routing or persistence', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-memory-reject-'));
  const routeHandlers = registerRoute(routeConfig(path.join(stateDir, 'route')));
  const memoryHandlers = registerMemory(memoryConfig(path.join(stateDir, 'memory')));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify(ROUTE_FIXTURE));
  };

  try {
    const missingParent = routeHandlers.get('subagent_spawning')(
      { childSessionKey: 'untrusted-child', agentId: 'research', mode: 'run', threadRequested: false },
      { childSessionKey: 'untrusted-child', requesterSessionKey: 'unknown-parent' },
    );
    assert.equal(missingParent.status, 'error');
    assert.equal(missingParent.error, 'CORTEX_DELEGATION_REJECTED: trusted parent/session envelope is missing or invalid');

    await assert.rejects(
      () => routeHandlers.get('before_prompt_build')(
        { prompt: 'Do not trust caller-injected lineage.' },
        {
          sessionKey: 'untrusted-child',
          agentId: 'main',
          cortexParentPrincipal: { senderId: 'owner-sender', sessionKey: 'forged-parent' },
        },
      ),
      (error) => error?.code === 'CORTEX_ROUTE_REQUIRED_FAILURE'
        && error?.reason === 'identity_unavailable'
        && /stopped before model execution/.test(error?.userMessage),
    );
    assert.equal(requests, 0);

    const parentSessionKey = 'authenticated-negative-parent';
    const childSessionKey = 'authenticated-negative-child';
    await routeHandlers.get('before_prompt_build')(
      { prompt: 'Authenticate the negative-test parent.' },
      { sessionKey: parentSessionKey, senderId: 'owner-sender', channel: 'whatsapp', agentId: 'main' },
    );
    routeHandlers.get('subagent_spawning')(
      { childSessionKey, agentId: 'research', mode: 'run', threadRequested: false },
      { childSessionKey, requesterSessionKey: parentSessionKey },
    );
    const beforeForgery = requests;
    await assert.rejects(
      () => routeHandlers.get('before_prompt_build')(
        { prompt: 'Reject a forged child sender.' },
        { sessionKey: childSessionKey, senderId: 'attacker-sender', agentId: 'research' },
      ),
      (error) => error?.code === 'CORTEX_ROUTE_REQUIRED_FAILURE' && error?.reason === 'identity_unavailable',
    );
    assert.equal(requests, beforeForgery);

    await assert.rejects(
      () => memoryHandlers.get('subagent_ended')(
        { targetSessionKey: 'different-child', targetKind: 'subagent', reason: 'completed', runId: 'forged-run', outcome: 'ok' },
        { runId: 'forged-run', childSessionKey, requesterSessionKey: parentSessionKey },
      ),
      /matching event and callback child session identity/,
    );
    assert.equal(requests, beforeForgery);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('required routing has a stable deadline even when fetch ignores AbortSignal', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-timeout-repair-'));
  const routeHandlers = registerRoute(routeConfig(stateDir, { timeoutMs: 100 }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Promise(() => {});
  const startedAt = Date.now();
  try {
    let failure;
    try {
      await routeHandlers.get('before_prompt_build')(
        { prompt: 'Exercise the bounded required-route deadline.' },
        { sessionKey: 'bounded-timeout-parent', senderId: 'owner-sender', channel: 'whatsapp', agentId: 'main' },
      );
    } catch (error) {
      failure = error;
    }
    const elapsedMs = Date.now() - startedAt;
    assert.equal(failure?.name, 'CortexRouteRequiredError');
    assert.equal(failure?.code, 'CORTEX_ROUTE_REQUIRED_FAILURE');
    assert.equal(failure?.reason, 'upstream_unavailable');
    assert.equal(failure?.retryable, true);
    assert.equal(failure?.timeoutMs, 100);
    assert.match(failure?.message, /this turn was stopped before model execution/);
    assert.ok(elapsedMs >= 75, `deadline fired too early at ${elapsedMs}ms`);
    assert.ok(elapsedMs < 1000, `deadline was not bounded: ${elapsedMs}ms`);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
