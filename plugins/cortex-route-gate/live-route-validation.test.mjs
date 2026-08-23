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
const SAFE_ROUTING_FAILURE = /routing unavailable while requireRouting is enabled; type=Error detail_hash=[0-9a-f]{64}/;
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
      SAFE_ROUTING_FAILURE,
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
      SAFE_ROUTING_FAILURE,
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
  assert.doesNotMatch(JSON.stringify(saved.plan), /private_retrieval_shadow|rollout gate|SYSTEM CONTEXT/);
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
  assert.doesNotMatch(JSON.stringify(saved.plan), /private_retrieval_shadow|PRIVATE_QUERY_CONTENT/);
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
    assert.equal(new Set(histories.map((rows) => JSON.stringify(rows[0].tokenDigests))).size, 3);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('optional routing uses a separately validated last-good plan after malformed HTTP 200', async () => {
  const cache = cachedPlan();
  const { context, saved } = await invoke({ requireRouting: false, cache, response: {} });
  assert.match(context, /routing_method: cached_fallback/);
  assert.match(context, /routing_provenance: authenticated_cache_plus_local_policy/);
  assert.match(context, /L7 \[score=0\.50\].*origin=cache;.*execution=not_observed/);
  assert.doesNotMatch(context, /This routing decision was made upstream by Cortex/);
  assert.deepEqual(saved.plan, {
    recommendedLevels: [{ level: 7 }],
    routingMethod: 'cached_route_plan',
  });
  assert.match(saved.provenance, /^[0-9a-f]{64}$/);
  assert.match(saved.scopeTag, /^[0-9a-f]{64}$/);
});

test('cached fallback preserves local mandatory provenance while marking provider recommendations cached', async () => {
  const cache = cachedPlan();
  cache.plan.recommendedLevels = [
    { level: 24, name: 'Nexus', reason: 'mandatory local routing policy', alwaysOn: false, origin: 'local_mandatory' },
    { level: 7, name: 'Mnemosyne', reason: 'provider selected', alwaysOn: false, origin: 'provider' },
    { level: 5, name: 'Oracle', reason: 'mandatory local reasoning policy', alwaysOn: false, origin: 'local_mandatory' },
  ];
  const { context } = await invoke({ requireRouting: false, cache, response: {} });
  assert.match(context, /L24 \[score=0\.50\].*origin=local_mandatory; policy=local_mandatory; execution=not_observed/);
  assert.match(context, /L7 \[score=0\.50\].*origin=cache; policy=optional; execution=not_observed/);
  assert.match(context, /L5 \[score=0\.50\].*origin=local_mandatory; policy=local_mandatory; execution=not_observed/);
  assert.doesNotMatch(context, /mandatory local routing policy|provider selected|mandatory local reasoning policy/);
});

test('optional routing does not treat a malformed HTTP 200 as a live plan', async () => {
  const { context, saved } = await invoke({ requireRouting: false, response: { recommended_levels: [] } });
  assert.equal(context, '');
  assert.equal(saved, null);
});

test('live routing converts boolean always_on into trusted persisted policy metadata', async () => {
  const { context, saved } = await invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24, name: 'Nexus', reason: 'live', always_on: true }], routing_method: 'always_on_test' },
  });
  assert.match(context, /routing_method: always_on_test/);
  assert.equal(saved.plan.recommendedLevels[0].level, 24);
  assert.equal('always_on' in saved.plan.recommendedLevels[0], false);
  assert.equal(saved.plan.recommendedLevels[0].alwaysOn, true);
  assert.equal(saved.plan.recommendedLevels[0].origin, 'provider');
  assert.match(context, /L24 Nexus.*origin=provider; policy=provider_always_on; execution=not_observed/);
});

test('optional cap retains all provider always-on levels and reports the cap contract', async () => {
  const alwaysOnLevels = [5, 17, 18, 20, 21, 22, 23, 24, 25, 27, 32, 33, 34, 35, 36];
  const response = {
    recommended_levels: [
      ...alwaysOnLevels.map((level) => ({ level, name: `Level ${level}`, always_on: true })),
      { level: 1, name: 'Optional one' },
      { level: 2, name: 'Optional two' },
    ],
    routing_method: 'always_on_cap_test',
  };
  const { context, saved } = await invoke({ requireRouting: true, response, config: { maxLevels: 1 } });
  const routeBlock = context.split('Before answering, apply the following routed recommendations and local policy for this turn:\n')[1]
    .split('\nExecution contract for this turn:')[0];
  const packed = [...routeBlock.matchAll(/^- L(\d+)/gm)].map((match) => Number(match[1]));
  for (const level of alwaysOnLevels) assert.ok(packed.includes(level), `missing provider always-on L${level}`);
  assert.equal(packed.filter((level) => !alwaysOnLevels.includes(level)).length, 1);
  assert.match(context, /level_cap: scope=optional_only optional_limit=1 mandatory_count=15 all_mandatory_retained=true/);
  assert.ok(saved.plan.recommendedLevels.filter((level) => level.alwaysOn === true).length >= alwaysOnLevels.length);
});

test('provider, local mandatory, and execution provenance remain distinct', async () => {
  const { context, saved } = await invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 7, name: 'Librarian', reason: 'provider selected' }], routing_method: 'provenance_test' },
  });
  assert.deepEqual(saved.plan.recommendedLevels.map(({ level, origin }) => ({ level, origin })), [
    { level: 24, origin: 'local_mandatory' },
    { level: 7, origin: 'provider' },
    { level: 5, origin: 'local_mandatory' },
  ]);
  assert.match(context, /L7 Librarian.*origin=provider; policy=optional; execution=not_observed/);
  assert.match(context, /L24 Nexus.*origin=local_mandatory; policy=local_mandatory; execution=not_observed/);
  assert.match(context, /execution_evidence: recommendations_only_not_observed_by_route_gate/);
  assert.doesNotMatch(context, /This routing decision was made upstream by Cortex/);
});

test('overlapping provider and local policy decisions retain both truths', async () => {
  const { context } = await invoke({
    requireRouting: true,
    prompt: 'Brainstorm an original visual concept with unusual ideas.',
    response: {
      recommended_levels: [
        { level: 24, name: 'Nexus', reason: 'provider selected', always_on: false },
        { level: 13, name: 'Dreamer', reason: 'provider selected', always_on: false },
      ],
      routing_method: 'overlap_provenance_test',
    },
  });
  assert.match(context, /L24 Nexus.*origin=provider; policy=local_mandatory; execution=not_observed/);
  assert.match(context, /L13 Dreamer.*origin=provider; policy=local_governor; execution=not_observed/);
});

test('live provider cannot forge route-gate-owned provenance', async () => {
  await assert.rejects(() => invoke({
    requireRouting: true,
    response: {
      recommended_levels: [{ level: 24, name: 'Nexus' }],
      routing_method: 'cached_fallback',
    },
  }), SAFE_ROUTING_FAILURE);
  await assert.rejects(() => invoke({
    requireRouting: true,
    response: {
      recommended_levels: [{ level: 24, name: 'Nexus' }],
      routing_method: 'live',
      routing_markers: { routeGateLivePlanReuse: { reused: true } },
    },
  }), SAFE_ROUTING_FAILURE);
});

test('live routing rejects non-boolean always_on metadata', async () => {
  await assert.rejects(() => invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24, always_on: 'true' }] },
  }), SAFE_ROUTING_FAILURE);
});

test('live provider cannot forge route-gate origin metadata', async () => {
  await assert.rejects(() => invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24, origin: 'local_mandatory' }] },
  }), SAFE_ROUTING_FAILURE);
});

test('routing POST uses the configured sensitive write-token header', async () => {
  let request;
  const startedAt = Date.now();
  await invoke({
    requireRouting: true,
    response: { recommended_levels: [{ level: 24 }] },
    config: { writeToken: 'route-secret', writeTokenHeader: 'X-Custom-Cortex-Token', timeoutMs: 1000 },
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
  const propagatedDeadline = Number(new Headers(request.init.headers).get('x-cortex-deadline-ms'));
  assert.ok(Number.isInteger(propagatedDeadline));
  assert.ok(propagatedDeadline > startedAt);
  assert.ok(propagatedDeadline <= startedAt + 1000);
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
      agentId: 'agent-a',
      channelId: 'channel-a',
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
  }), SAFE_ROUTING_FAILURE);
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
