import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import register from './index.ts';

const CACHE_SECRET = 'deployment-held-test-secret';
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

async function invoke({ requireRouting, cache, response, config = {}, inspectRequest, sessionKey = `agent:main:test:${Math.random()}`, prompt = 'Route this' }) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-live-route-'));
  if (cache) fs.writeFileSync(path.join(stateDir, 'last-good-plan.json'), JSON.stringify(cache));
  const handlers = new Map();
  register({
    config: { enabled: true, requireRouting, baseUrl: 'http://127.0.0.1:18888', routeCacheHmacSecret: CACHE_SECRET, sessionIdentityHmacSecret: 'session-identity-default-test-secret', stateDir, ...config },
    logger: { info() {}, warn() {} },
    on(name, handler) { handlers.set(name, handler); },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    inspectRequest?.(url, init);
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await handlers.get('before_prompt_build')(
      { prompt, messages: [{ role: 'user', content: prompt }] },
      { sessionKey },
    );
    return { context: String(result?.appendSystemContext || ''), saved: fs.existsSync(path.join(stateDir, 'last-good-plan.json')) ? JSON.parse(fs.readFileSync(path.join(stateDir, 'last-good-plan.json'), 'utf8')) : null };
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

for (const response of [{}, { recommended_levels: [] }, { recommended_levels: [{ level: '24' }] }]) {
  test(`requireRouting rejects malformed HTTP 200 route response ${JSON.stringify(response)}`, async () => {
    await assert.rejects(() => invoke({ requireRouting: true, response }), /invalid live route response schema/);
  });
}

test('optional routing uses a separately validated last-good plan after malformed HTTP 200', async () => {
  const cache = cachedPlan();
  const { context, saved } = await invoke({ requireRouting: false, cache, response: {} });
  assert.match(context, /routing_method: cached_fallback/);
  assert.match(context, /L7 Mnemosyne/);
  assert.deepEqual(saved, cache);
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
  assert.deepEqual(JSON.parse(String(request.init.body)), { query: 'Route this' });
  assert.match(new Headers(request.init.headers).get('x-session-id'), /^openclaw-[0-9a-f]{64}$/);
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
