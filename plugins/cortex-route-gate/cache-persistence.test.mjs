import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import register from './index.ts';

async function invokeWithUnwritableCache(requireRouting, seedCrashTemporary = false) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-cache-persistence-'));
  const cachePath = path.join(stateDir, 'last-good-plan.json');
  fs.mkdirSync(cachePath);
  const crashTemporary = path.join(stateDir, 'prompt-history.json.999999.1.tmp');
  if (seedCrashTemporary) fs.writeFileSync(crashTemporary, 'partial');
  const handlers = new Map();
  const warnings = [];
  register({
    config: {
      enabled: true,
      requireRouting,
      sessionIdentityHmacSecret: 'session-identity-cache-persistence-test-secret',
      scopeCredentialId: 'route-cache-persistence-test',
      scopeHmacSecret: 'route-cache-persistence-scope-secret',
      baseUrl: 'http://127.0.0.1:18888',
      routeCacheHmacSecret: 'deployment-held-test-secret',
      oracleSessionDir: stateDir,
      stateDir,
    },
    logger: {
      info() {},
      warn(message) { warnings.push(String(message)); },
    },
    on(name, handler) { handlers.set(name, handler); },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    recommended_levels: [{ level: 24, name: 'Nexus', reason: 'validated live route' }],
    routing_method: 'live_persistence_test',
    reasoning: ['live routing succeeded'],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const result = await handlers.get('before_prompt_build')(
      { prompt: 'Route this request', messages: [{ role: 'user', content: 'Route this request' }] },
      { sessionKey: `agent:main:test:cache-persistence-${requireRouting}` },
    );
    return { context: String(result?.appendSystemContext || ''), warnings, stateDir, crashTemporary };
  } catch (error) {
    fs.rmSync(stateDir, { recursive: true, force: true });
    throw error;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

for (const requireRouting of [true, false]) {
  test(`validated live routing survives cache persistence failure when requireRouting=${requireRouting}`, async () => {
    const { context, warnings, stateDir } = await invokeWithUnwritableCache(requireRouting);
    try {
      assert.match(context, /routing_method: live_persistence_test/);
      assert.match(context, /live routing succeeded/);
      assert.doesNotMatch(context, /cached_fallback/);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /failed to persist last-good route plan/);
      assert.doesNotMatch(warnings[0], /routing failed for prompt/);
      assert.deepEqual(fs.readdirSync(stateDir).filter((name) => name.includes('.tmp')), []);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
}

test('atomic persistence reclaims crash leftovers without Linux /proc descriptor paths', async () => {
  const originalReaddirSync = fs.readdirSync;
  const originalStatSync = fs.statSync;
  let procAttempts = 0;
  fs.readdirSync = function (target, options) {
    if (String(target).startsWith('/proc/self/fd/')) {
      procAttempts += 1;
      const error = new Error('procfs unavailable');
      error.code = 'ENOENT';
      throw error;
    }
    return originalReaddirSync.call(this, target, options);
  };
  fs.statSync = function (target, options) {
    if (String(target).startsWith('/proc/self/fd/')) {
      procAttempts += 1;
      const error = new Error('procfs unavailable');
      error.code = 'ENOENT';
      throw error;
    }
    return originalStatSync.call(this, target, options);
  };
  try {
    const { context, warnings, stateDir, crashTemporary } = await invokeWithUnwritableCache(false, true);
    try {
      assert.match(context, /routing_method: live_persistence_test/);
      assert.ok(procAttempts > 0);
      assert.equal(fs.existsSync(crashTemporary), false);
      assert.equal(warnings.length, 1);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  } finally {
    fs.readdirSync = originalReaddirSync;
    fs.statSync = originalStatSync;
  }
});
