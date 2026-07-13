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

function signed(cache, secret = CACHE_SECRET) {
  const payload = { savedAt: cache.savedAt, provenance: cache.provenance, plan: cache.plan };
  return { ...payload, tag: crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex') };
}

function validCache(secret = CACHE_SECRET) {
  return signed({
    savedAt: new Date().toISOString(),
    provenance: 'http://127.0.0.1:18888',
    plan: {
      recommendedLevels: [
        { level: 24, name: 'Nexus', reason: 'cached routing', method: 'semantic', score: 0.9 },
        { level: 5, name: 'Oracle', reason: 'baseline reasoning', score: 0.8 },
      ],
      routingMethod: 'semantic_orchestration',
      reasoning: ['cached reasoning'],
      routingMarkers: { cortex_first: true, coding_chain: ['lab', 'validator'], kernel_context_chars: 12 },
      workflowCheckpoint: {
        checkpoint_id: '0123456789abcdef',
        state_machine: ['received', 'analyzed', 'planned', 'responded'],
        current_state: 'responded',
        retry_policy: { max_attempts: 2, backoff_ms: 120 },
        levels: [24, 5],
        durable_store: '/tmp/checkpoints.jsonl',
      },
    },
  }, secret);
}

async function contextForCache(cache, secret = CACHE_SECRET) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-cache-'));
  fs.writeFileSync(path.join(stateDir, 'last-good-plan.json'), JSON.stringify(cache));
  const handlers = new Map();
  register({
    config: {
      enabled: true,
      requireRouting: false,
      baseUrl: 'http://127.0.0.1:18888',
      timeoutMs: 250,
      maxCachedPlanAgeMs: 300_000,
      ...(secret === undefined ? {} : { routeCacheHmacSecret: secret }),
      stateDir,
    },
    logger: { info() {}, warn() {} },
    on(name, handler) { handlers.set(name, handler); },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('routing offline'); };
  try {
    const result = await handlers.get('before_prompt_build')(
      { prompt: 'Status request', messages: [{ role: 'user', content: 'What is the status?' }] },
      { sessionKey: `agent:main:test:cache-${Math.random()}` },
    );
    return String(result?.appendSystemContext || '');
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

test('a valid authenticated last-good route plan is used when routing is offline', async () => {
  const context = await contextForCache(validCache());

  assert.match(context, /routing_method: cached_fallback/);
  assert.match(context, /cached reasoning/);
});

test('wrong or missing deployment cache key fails safe', async () => {
  assert.equal(await contextForCache(validCache(), 'wrong-secret'), '');
  assert.equal(await contextForCache(validCache(), null), '');
});

test('cache authentication covers timestamp, baseUrl, plan, and reasoning', async (t) => {
  const mutations = {
    timestamp: (cache) => { cache.savedAt = new Date(Date.parse(cache.savedAt) - 1_000).toISOString(); },
    baseUrl: (cache) => { cache.provenance = 'http://127.0.0.1:18889'; },
    plan: (cache) => { cache.plan.recommendedLevels[0].reason = 'tampered'; },
    reasoning: (cache) => { cache.plan.reasoning[0] = 'tampered reasoning'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async () => {
      const cache = validCache();
      mutate(cache);
      assert.equal(await contextForCache(cache), '');
    });
  }
});

test('malformed or missing authentication tag is rejected', async () => {
  const missing = validCache();
  delete missing.tag;
  assert.equal(await contextForCache(missing), '');
  assert.equal(await contextForCache({ ...validCache(), tag: 'not-a-tag' }), '');
});

test('tampered last-good route plans are rejected as a whole', async (t) => {
  const mutations = {
    'unknown Cortex level': (cache) => { cache.plan.recommendedLevels[0].level = 39; },
    'out-of-range score': (cache) => { cache.plan.recommendedLevels[0].score = 1.01; },
    'non-string reasoning item': (cache) => { cache.plan.reasoning.push({ injected: true }); },
    'invalid nested routing marker': (cache) => { cache.plan.routingMarkers.payload = Array(129).fill('x'); },
    'invalid checkpoint retry bound': (cache) => { cache.plan.workflowCheckpoint.retry_policy.max_attempts = 101; },
    'invalid checkpoint level': (cache) => { cache.plan.workflowCheckpoint.levels = [0]; },
    'unexpected nested level field': (cache) => { cache.plan.recommendedLevels[0].action = '/admin'; },
  };

  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async () => {
      const cache = validCache();
      mutate(cache);
      const context = await contextForCache(cache);
      assert.equal(context, '');
      assert.doesNotMatch(context, /routing_method: cached_fallback/);
      assert.doesNotMatch(context, /cached reasoning/);
    });
  }
});
