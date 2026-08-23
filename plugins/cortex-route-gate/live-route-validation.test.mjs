import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import register from './index.ts';

const CACHE_SECRET = 'deployment-held-test-secret';
const VALID_PROVIDER_FIXTURE = JSON.parse(fs.readFileSync(
  new URL('./nexus-orchestrate-response.fixture.json', import.meta.url),
  'utf8',
));

function canonicalLiveResponse(response) {
  if (!Array.isArray(response?.recommended_levels) || response.recommended_levels.length < 1) return response;
  return {
    ...VALID_PROVIDER_FIXTURE,
    recommended_levels: response.recommended_levels,
    ...response,
  };
}
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
function cachedPlan() {
  const cache = {
    savedAt: new Date().toISOString(),
    provenance: 'http://127.0.0.1:18888',
    plan: { recommendedLevels: [{ level: 7, name: 'Mnemosyne', reason: 'last good' }], routingMethod: 'live_validated' },
  };
  return { ...cache, tag: crypto.createHmac('sha256', CACHE_SECRET).update(canonicalJson(cache)).digest('hex') };
}

async function invoke({ requireRouting, cache, response, config = {}, context = {}, inspectRequest, sessionKey = `agent:main:test:${Math.random()}`, prompt = 'Route this', messages, complete = false, canonicalizeResponse = true }) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-live-route-'));
  const handlers = new Map();
  register({
    config: {
      enabled: true,
      requireRouting,
      baseUrl: 'http://127.0.0.1:18888',
      routeCacheHmacSecret: CACHE_SECRET,
      sessionIdentityHmacSecret: 'session-identity-default-test-secret',
      agentId: 'test-agent',
      userId: 'test-user',
      channelId: 'test-channel',
      writeToken: 'route-gate-production-write-token',
      scopeCredentialId: 'route-default-test',
      scopeHmacSecret: 'route-default-scope-secret',
      stateDir,
      ...config,
    },
    logger: { info() {}, warn() {} },
    on(name, handler) { handlers.set(name, handler); },
  });
  const sessionSecret = config.sessionIdentityHmacSecret || 'session-identity-default-test-secret';
  const sessionIdentity = `openclaw-${crypto.createHmac('sha256', sessionSecret).update(sessionKey).digest('hex')}`;
  const trustedContext = {
    agentId: 'test-agent',
    userId: 'test-user',
    channelId: 'test-channel',
    ...context,
  };
  const scope = [
    config.tenantId || 'cortex-local',
    config.workspaceId || 'default',
    trustedContext.agentId,
    trustedContext.userId || trustedContext.requesterSenderId,
    trustedContext.channelId || trustedContext.messageChannel,
    sessionIdentity,
  ].join('\n');
  const scopeTag = crypto.createHmac('sha256', sessionSecret).update(`cortex.route-gate.state.v1\n${scope}`).digest('hex');
  const principalDir = path.join(stateDir, 'principals', scopeTag);
  fs.mkdirSync(principalDir, { recursive: true });
  const cachePath = path.join(principalDir, 'last-good-plan.json');
  if (cache) {
    const boundCache = { ...cache, scopeTag };
    boundCache.tag = crypto.createHmac('sha256', CACHE_SECRET).update(canonicalJson({ savedAt: boundCache.savedAt, provenance: boundCache.provenance, scopeTag, plan: boundCache.plan })).digest('hex');
    fs.writeFileSync(cachePath, JSON.stringify(boundCache));
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    inspectRequest?.(url, init);
    const payload = canonicalizeResponse ? canonicalLiveResponse(response) : response;
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const callbackContext = { sessionKey, ...trustedContext };
    const result = await handlers.get('before_prompt_build')(
      { prompt, messages: messages || [{ role: 'user', content: prompt }] },
      callbackContext,
    );
    if (complete) {
      await handlers.get('llm_output')({ assistantTexts: ['bounded answer without private content'] }, callbackContext);
      await handlers.get('agent_end')({ success: true }, callbackContext);
    }
    const telemetryPath = path.join(principalDir, 'private-retrieval-shadow-telemetry.json');
    return {
      context: String(result?.appendSystemContext || ''),
      saved: fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : null,
      telemetry: fs.existsSync(telemetryPath) ? JSON.parse(fs.readFileSync(telemetryPath, 'utf8')) : null,
      telemetryMode: fs.existsSync(telemetryPath) ? fs.statSync(telemetryPath).mode & 0o777 : null,
    };
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

for (const response of [{}, { recommended_levels: [] }, { recommended_levels: [{ level: '24' }] }]) {
  test(`requireRouting rejects malformed HTTP 200 route response ${JSON.stringify(response)}`, async () => {
    await assert.rejects(
      () => invoke({ requireRouting: true, response, canonicalizeResponse: false }),
      /invalid live route response schema/,
    );
  });
}

for (const response of [
  { ...VALID_PROVIDER_FIXTURE, success: false },
  { ...VALID_PROVIDER_FIXTURE, reasoning: undefined },
  { ...VALID_PROVIDER_FIXTURE, routing_markers: undefined },
  { ...VALID_PROVIDER_FIXTURE, contract: undefined },
]) {
  test('requireRouting rejects a failed or incomplete provider contract', async () => {
    await assert.rejects(
      () => invoke({ requireRouting: true, response, canonicalizeResponse: false }),
      /invalid live route response schema/,
    );
  });
}

test('shared provider-consumer fixture is accepted as a live route', async () => {
  const { context } = await invoke({
    requireRouting: true,
    response: VALID_PROVIDER_FIXTURE,
    canonicalizeResponse: false,
  });
  assert.match(context, /routing_method: shared_contract_fixture/);
});

test('private retrieval shadow uses isolated user intent and remains absent from prompt/cache content', async () => {
  let requestBody;
  const observationId = 'a'.repeat(32);
  const { context, saved, telemetry, telemetryMode } = await invoke({
    requireRouting: true,
    prompt: 'SYSTEM CONTEXT and prior history that must not become a private retrieval query',
    messages: [{ role: 'user', content: 'What did we decide about the rollout gate?' }],
    response: {
      recommended_levels: [{ level: 24, name: 'Nexus', reason: 'live' }],
      routing_method: 'shadow_test',
      routing_markers: {
        private_retrieval_shadow: {
          schemaVersion: 'cortex.private_retrieval_shadow.v1',
          mode: 'observe_only',
          enabled: true,
          killSwitch: false,
          eligible: true,
          selectionReason: 'selective_private_fact_lookup',
          factClass: 'prior_decision',
          answerInfluence: false,
          candidateContentExposed: false,
          scheduled: true,
          observationId,
        },
      },
    },
    inspectRequest(_url, init) { requestBody = JSON.parse(String(init.body)); },
    complete: true,
  });
  assert.equal(requestBody.query, 'SYSTEM CONTEXT and prior history that must not become a private retrieval query');
  assert.equal(requestBody.private_retrieval_shadow_query, 'What did we decide about the rollout gate?');
  assert.doesNotMatch(context, /private_retrieval_shadow|selective_private_fact_lookup|aaaaaaaaaaaaaaaa/);
  assert.equal(saved.plan.routingMarkers.private_retrieval_shadow, undefined);
  assert.equal(telemetry.mode, 'observe_only');
  assert.equal(telemetry.answerInfluence, false);
  assert.equal(telemetry.records[0].observationId, observationId);
  assert.equal(telemetry.records[0].qualityCompared, false);
  assert.equal(telemetry.records[0].baselineMemorySearchAttempted, false);
  assert.equal(telemetryMode, 0o600);
  assert.doesNotMatch(JSON.stringify(telemetry), /rollout gate|bounded answer|SYSTEM CONTEXT/);
});

test('content-like shadow marker fields are rejected instead of persisted', async () => {
  const { context, saved, telemetry } = await invoke({
    requireRouting: true,
    prompt: 'ordinary prompt',
    response: {
      recommended_levels: [{ level: 24, name: 'Nexus', reason: 'live' }],
      routing_method: 'shadow_test',
      routing_markers: {
        private_retrieval_shadow: {
          schemaVersion: 'cortex.private_retrieval_shadow.v1',
          mode: 'observe_only',
          enabled: true,
          killSwitch: false,
          eligible: false,
          selectionReason: 'PRIVATE_QUERY_CONTENT',
          factClass: 'unknown',
          answerInfluence: false,
          candidateContentExposed: false,
          scheduled: false,
        },
      },
    },
    complete: true,
  });
  assert.doesNotMatch(context, /PRIVATE_QUERY_CONTENT|private_retrieval_shadow/);
  assert.equal(saved.plan.routingMarkers.private_retrieval_shadow, undefined);
  assert.equal(telemetry, null);
});

test('private retrieval never falls back to accumulated prompt without a structured user turn', async () => {
  let requestBody;
  await invoke({
    requireRouting: true,
    prompt: 'SYSTEM CONTEXT and prior history only',
    messages: [],
    response: {
      recommended_levels: [{ level: 24, name: 'Nexus', reason: 'live' }],
      routing_method: 'shadow_test',
    },
    inspectRequest(_url, init) { requestBody = JSON.parse(String(init.body)); },
  });
  assert.equal(requestBody.query, 'SYSTEM CONTEXT and prior history only');
  assert.equal(requestBody.private_retrieval_shadow_query, '');
});

test('configured hook fallbacks and callback principals never share adaptive state', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-principal-isolation-'));
  const handlers = new Map();
  register({
    config: {
      enabled: true,
      requireRouting: true,
      baseUrl: 'http://127.0.0.1:18888',
      routeCacheHmacSecret: CACHE_SECRET,
      sessionIdentityHmacSecret: 'principal-isolation-session-secret',
      // These fixed deployment values cover OpenClaw hook shapes that omit
      // one or more principal dimensions.
      agentId: 'configured-agent',
      userId: 'configured-user',
      channelId: 'configured-channel',
      writeToken: 'route-gate-production-write-token',
      scopeCredentialId: 'route-principal-isolation-test',
      scopeHmacSecret: 'route-principal-isolation-scope-secret',
      stateDir,
    },
    logger: { info() {}, warn() {} },
    on(name, handler) { handlers.set(name, handler); },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(canonicalLiveResponse({
    recommended_levels: [{ level: 24, name: 'Nexus', reason: 'isolated' }],
    routing_method: 'principal_isolation',
    reasoning: ['principal local'],
  })), { status: 200, headers: { 'content-type': 'application/json' } });
  const handler = handlers.get('before_prompt_build');
  const sessionKey = 'agent:main:shared-session';
  try {
    await handler(
      { prompt: 'Route with configured hook identity', messages: [] },
      { sessionKey },
    );
    await handler(
      { prompt: 'Tenant A private blue ocean prompt', messages: [] },
      { sessionKey, agentId: 'agent-a', userId: 'user-a', channelId: 'channel-a' },
    );
    await handler(
      { prompt: 'Tenant B independent green field prompt', messages: [] },
      { sessionKey, agentId: 'agent-b', userId: 'user-b', channelId: 'channel-b' },
    );
    const principalRoot = path.join(stateDir, 'principals');
    const directories = fs.readdirSync(principalRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    assert.equal(directories.length, 3);
    const histories = directories.map((entry) => JSON.parse(fs.readFileSync(path.join(principalRoot, entry.name, 'prompt-history.json'), 'utf8')));
    assert.deepEqual(histories.map((rows) => rows.length).sort(), [1, 1, 1]);
    assert.equal(new Set(histories.map((rows) => JSON.stringify(rows[0].tokens))).size, 3);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('optional routing uses a separately validated last-good plan after malformed HTTP 200', async () => {
  const cache = cachedPlan();
  const { context, saved } = await invoke({ requireRouting: false, cache, response: {} });
  assert.match(context, /routing_method: cached_fallback/);
  assert.match(context, /L7 Mnemosyne/);
  assert.deepEqual(saved.plan, cache.plan);
  assert.equal(saved.provenance, cache.provenance);
  assert.match(saved.scopeTag, /^[0-9a-f]{64}$/);
});

test('optional routing does not treat a malformed HTTP 200 as a live plan', async () => {
  const { context, saved } = await invoke({ requireRouting: false, response: { recommended_levels: [] } });
  assert.equal(context, '');
  assert.equal(saved, null);
});

test('live routing accepts boolean always_on and strips transport-only metadata from persisted plans', async () => {
  const { context, saved } = await invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24, name: 'Nexus', reason: 'live', always_on: true }], routing_method: 'always_on_test' },
  });
  assert.match(context, /routing_method: always_on_test/);
  assert.equal(saved.plan.recommendedLevels[0].level, 24);
  assert.equal('always_on' in saved.plan.recommendedLevels[0], false);
});

test('live routing rejects non-boolean always_on metadata', async () => {
  await assert.rejects(() => invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24, always_on: 'true' }] },
  }), /invalid live route response schema/);
});

test('routing POST uses the configured sensitive write-token header', async () => {
  let request;
  await invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24 }] },
    config: { writeToken: 'route-secret', writeTokenHeader: 'X-Custom-Cortex-Token' },
    inspectRequest(url, init) { request = { url, init }; },
  });
  assert.equal(request.init.method, 'POST');
  assert.equal(new Headers(request.init.headers).get('x-custom-cortex-token'), 'route-secret');
  assert.equal(new URL(request.url).pathname, '/nexus/orchestrate');
  assert.equal(new URL(request.url).search, '', 'the prompt must not enter the query string');
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    query: 'Route this',
    private_retrieval_shadow_query: 'Route this',
  });
  assert.match(new Headers(request.init.headers).get('x-session-id'), /^openclaw-[0-9a-f]{64}$/);
});

test('minimal production route configuration signs the default cortex-local scope', async () => {
  let headers;
  await invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24 }] },
    inspectRequest(_url, init) { headers = new Headers(init.headers); },
  });
  assert.equal(headers.get('x-cortex-tenant-id'), 'cortex-local');
  assert.equal(headers.get('x-cortex-workspace-id'), 'default');
  assert.equal(headers.get('x-cortex-scope-credential-id'), 'route-default-test');
  assert.match(headers.get('x-cortex-scope-signature'), /^[0-9a-f]{64}$/);
});

test('configured principal fallbacks cover the current OpenClaw prompt-hook context', async () => {
  let headers;
  await invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24 }] },
    context: { userId: undefined, requesterSenderId: undefined },
    inspectRequest(_url, init) { headers = new Headers(init.headers); },
  });
  assert.equal(headers.get('x-cortex-agent-id'), 'test-agent');
  assert.equal(headers.get('x-cortex-user-id'), 'test-user');
  assert.equal(headers.get('x-cortex-channel-id'), 'test-channel');
  assert.match(headers.get('x-cortex-scope-signature'), /^[0-9a-f]{64}$/);
});

test('routing forwards distinct bounded HMAC identities without exposing raw session keys', async () => {
  const identities = [];
  for (const sessionKey of ['agent:main:tenant-a:user-a', 'agent:main:tenant-a:user-b']) {
    await invoke({
      requireRouting: true,
      response: { recommended_levels: [{ level: 24 }] },
      sessionKey,
      config: { sessionIdentityHmacSecret: 'session-identity-test-secret' },
      inspectRequest(_url, init) { identities.push(new Headers(init.headers).get('x-session-id')); },
    });
    const expected = crypto.createHmac('sha256', 'session-identity-test-secret').update(sessionKey).digest('hex');
    assert.equal(identities.at(-1), `openclaw-${expected}`);
    assert.doesNotMatch(identities.at(-1), new RegExp(sessionKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.notEqual(identities[0], identities[1]);
});

test('routing binds the opaque session to a complete signed trusted principal', async () => {
  let headers;
  const sessionKey = 'agent:trusted:tenant-a:user-a';
  await invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24 }] },
    sessionKey,
    context: {
      agentId: 'agent-a',
      userId: '',
      requesterSenderId: 'user-a',
      channelId: '',
      messageChannel: 'channel-a',
    },
    config: {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      scopeCredentialId: 'route-credential',
      scopeHmacSecret: 'route-scope-secret',
      sessionIdentityHmacSecret: 'shared-session-secret',
      writeToken: 'route-gate-production-write-token',
    },
    inspectRequest(_url, init) { headers = new Headers(init.headers); },
  });

  const sessionId = `openclaw-${crypto.createHmac('sha256', 'shared-session-secret').update(sessionKey).digest('hex')}`;
  const canonical = [
    'cortex.memory.principal.v2',
    'route-credential',
    'tenant-a',
    'workspace-a',
    'agent-a',
    'user-a',
    'channel-a',
    sessionId,
  ].join('\n');
  assert.deepEqual(
    Object.fromEntries([
      'x-session-id',
      'x-cortex-tenant-id',
      'x-cortex-workspace-id',
      'x-cortex-agent-id',
      'x-cortex-user-id',
      'x-cortex-channel-id',
      'x-cortex-session-id',
      'x-cortex-scope-credential-id',
    ].map((name) => [name, headers.get(name)])),
    {
      'x-session-id': sessionId,
      'x-cortex-tenant-id': 'tenant-a',
      'x-cortex-workspace-id': 'workspace-a',
      'x-cortex-agent-id': 'agent-a',
      'x-cortex-user-id': 'user-a',
      'x-cortex-channel-id': 'channel-a',
      'x-cortex-session-id': sessionId,
      'x-cortex-scope-credential-id': 'route-credential',
    },
  );
  assert.equal(
    headers.get('x-cortex-scope-signature'),
    crypto.createHmac('sha256', 'route-scope-secret').update(canonical).digest('hex'),
  );
});

test('required routing fails closed without trusted session identity', async () => {
  await assert.rejects(() => invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24 }] },
    sessionKey: '',
  }), /non-empty trusted session identity/);
});

test('required routing rejects fallback to unrelated write or cache credentials', async () => {
  await assert.rejects(() => invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24 }] },
    config: { sessionIdentityHmacSecret: '', writeToken: 'must-not-sign-sessions' },
  }), /keyed session identity secret/);
});

test('routing rejects prompts above the configured POST-body byte limit before fetch', async () => {
  let fetched = false;
  await assert.rejects(() => invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24 }] },
    prompt: 'x'.repeat(1025),
    config: { maxRoutingPromptBytes: 1024 },
    inspectRequest() { fetched = true; },
  }), /routing prompt exceeds 1024 bytes/);
  assert.equal(fetched, false);
});

test('routing fails closed on an invalid write-token header name', async () => {
  await assert.rejects(() => invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24 }] },
    config: { writeToken: 'route-secret', writeTokenHeader: 'bad header' },
  }), /invalid Cortex write-token header name/);
});

for (const count of [63, 64]) {
  test(`${count}-entry live response missing mandatory levels normalizes within 64 and routes live`, async () => {
    const recommended_levels = Array.from({ length: count }, (_, index) => ({
      level: (index % 36) + 1 === 5 || (index % 36) + 1 === 24 ? 38 : (index % 36) + 1,
      name: `Level ${index}`,
      reason: 'live',
    }));
    const { context, saved } = await invoke({ requireRouting: true, response: { recommended_levels, routing_method: 'live_test' } });
    assert.match(context, /routing_method: live_test/);
    assert.ok(saved.plan.recommendedLevels.length <= 64);
    assert.equal(new Set(saved.plan.recommendedLevels.map((item) => item.level)).size, saved.plan.recommendedLevels.length);
    assert.ok(saved.plan.recommendedLevels.some((item) => item.level === 24));
    assert.ok(saved.plan.recommendedLevels.some((item) => item.level === 5));
  });
}
