import test from 'node:test';
import assert from 'node:assert/strict';

import plugin, { ExpiringLruMap, durabilityScore, buildWriteThroughMetadata, lifecyclePersistenceKey, reconcileResults } from './index.ts';

test('lifecycle keys hash exact length-delimited session and payload bytes', () => {
  const sharedSuffix = 'x'.repeat(5_000);
  const first = lifecyclePersistenceKey('session', `first:${sharedSuffix}`);
  const second = lifecyclePersistenceKey('session', `second:${sharedSuffix}`);

  assert.notEqual(first, second, 'payloads differing outside the old truncated suffix remain distinct');
  assert.equal(first, lifecyclePersistenceKey('session', `first:${sharedSuffix}`), 'identical retries are stable');
  assert.notEqual(
    lifecyclePersistenceKey('ab', 'c'),
    lifecyclePersistenceKey('a', 'bc'),
    'length delimiters make session/payload boundaries unambiguous',
  );
  assert.match(first, /^session:[0-9a-f]{64}$/);
});

test('recent output cache is deterministic LRU with bounded capacity and TTL expiry', () => {
  const cache = new ExpiringLruMap(2, 100);
  cache.set('abandoned-a', 'a', 1_000);
  cache.set('abandoned-b', 'b', 1_010);
  assert.equal(cache.get('abandoned-a', 1_020), 'a');

  cache.set('abandoned-c', 'c', 1_030);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('abandoned-b', 1_030), undefined, 'least-recently-used session is evicted');
  assert.equal(cache.get('abandoned-a', 1_099), 'a');
  assert.equal(cache.get('abandoned-a', 1_100), undefined, 'TTL is based on insertion, not reads');
  assert.equal(cache.get('abandoned-c', 1_130), undefined);
  assert.equal(cache.size, 0);
});

test('agent_end eagerly deletes recent output lifecycle state', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body || '{}')));
    return { ok: true, headers: new Headers(), body: null, text: async () => '{}' };
  };
  try {
    plugin.register({
      pluginConfig: { enabledWriteThrough: true, minDurabilityScore: 0 },
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    handlers.get('llm_output')({ content: 'durable first lifecycle output' }, { sessionKey: 'session-ended' });
    await handlers.get('agent_end')({}, { sessionKey: 'session-ended' });
    await handlers.get('subagent_ended')({}, { sessionKey: 'session-ended' });

    assert.equal(requests.length, 1);
    assert.match(requests[0].content, /durable first lifecycle output/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed subagent persistence is retried by agent_end with the same idempotency key', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body || '{}'));
    requests.push(body);
    if (requests.length === 1) throw new Error('transient write failure');
    return { ok: true, headers: new Headers(), body: null };
  };
  try {
    plugin.register({
      pluginConfig: { enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 },
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    handlers.get('llm_output')({ content: 'durable lifecycle output that must survive a transient failure' }, { sessionKey: 'retry-session' });
    await handlers.get('subagent_ended')({}, { sessionKey: 'retry-session' });
    await handlers.get('agent_end')({}, { sessionKey: 'retry-session' });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].idempotency_key, requests[1].idempotency_key);
    assert.match(requests[1].content, /durable lifecycle output/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lifecycle writes distinguish bounded outputs that share a long suffix', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body || '{}')));
    return { ok: true, headers: new Headers(), body: null };
  };
  try {
    plugin.register({
      pluginConfig: { enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 },
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const sharedSuffix = 'x'.repeat(3_000);
    handlers.get('llm_output')({ content: `first:${sharedSuffix}` }, { sessionKey: 'same-session' });
    await handlers.get('agent_end')({}, { sessionKey: 'same-session' });
    handlers.get('llm_output')({ content: `second:${sharedSuffix}` }, { sessionKey: 'same-session' });
    await handlers.get('agent_end')({}, { sessionKey: 'same-session' });

    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].idempotency_key, requests[1].idempotency_key);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent lifecycle hooks coalesce into one persistence write', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body || '{}')));
    await blocked;
    return { ok: true, headers: new Headers(), body: null };
  };
  try {
    plugin.register({
      pluginConfig: { enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 },
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    handlers.get('llm_output')({ content: 'one durable output shared by concurrent lifecycle hooks' }, { sessionKey: 'concurrent-session' });
    const first = handlers.get('subagent_ended')({}, { sessionKey: 'concurrent-session' });
    const second = handlers.get('agent_end')({}, { sessionKey: 'concurrent-session' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 1);
    release();
    await Promise.all([first, second]);
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('distinct lifecycle runs persist identical output in the same session', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body || '{}')));
    return { ok: true, headers: new Headers(), body: null };
  };
  try {
    plugin.register({
      pluginConfig: { enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 },
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const output = handlers.get('llm_output');
    const end = handlers.get('agent_end');
    output({ content: 'the same legitimate durable completion' }, { sessionKey: 'repeat-session' });
    await end({}, { sessionKey: 'repeat-session', runId: 'run-one' });
    output({ content: 'the same legitimate durable completion' }, { sessionKey: 'repeat-session' });
    await end({}, { sessionKey: 'repeat-session', runId: 'run-two' });

    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].idempotency_key, requests[1].idempotency_key);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent hooks with the same lifecycle run coalesce despite differing output', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body || '{}')));
    await blocked;
    return { ok: true, headers: new Headers(), body: null };
  };
  try {
    plugin.register({
      pluginConfig: { enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 },
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const first = handlers.get('subagent_ended')(
      { result: 'durable completion from the subagent hook', runId: 'shared-run' },
      { sessionKey: 'shared-run-session' },
    );
    const second = handlers.get('agent_end')(
      { result: 'durable completion with slightly different agent hook text' },
      { sessionKey: 'shared-run-session', run_id: 'shared-run' },
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 1);
    release();
    await Promise.all([first, second]);
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recent outputs are truncated before caching, keying, and concurrent persistence', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body || '{}')));
    await blocked;
    return { ok: true, headers: new Headers(), body: null };
  };
  try {
    plugin.register({
      pluginConfig: { enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0, recentOutputMaxChars: 64 },
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const retainedTail = 'TAIL-' + '🛡️'.repeat(20);
    assert.equal(retainedTail.length, 65);
    const expected = retainedTail.slice(-64);
    handlers.get('llm_output')({ content: `${'attacker-prefix-'.repeat(100_000)}${retainedTail}` }, { sessionKey: 'bounded-session' });

    const first = handlers.get('subagent_ended')({}, { sessionKey: 'bounded-session' });
    const second = handlers.get('agent_end')({}, { sessionKey: 'bounded-session' });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 1, 'concurrent hooks coalesce on the truncated payload key');
    assert.equal(requests[0].idempotency_key, lifecyclePersistenceKey('bounded-session', `content:${expected}`));
    assert.match(requests[0].content, new RegExp(expected.slice(-20)));
    assert.doesNotMatch(requests[0].content, /attacker-prefix/);
    release();
    await Promise.all([first, second]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lifecycle persistence enforces exact admission cap, coalesces, cleans up, and admits retry', async () => {
  const handlers = new Map();
  const requests = [];
  const warnings = [];
  const releases = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body || '{}')));
    await new Promise((resolve) => { releases.push(resolve); });
    return { ok: true, headers: new Headers(), body: null };
  };
  try {
    plugin.register({
      pluginConfig: { enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0, lifecycleMaxInFlight: 2 },
      logger: { info() {}, warn(message) { warnings.push(message); } },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const output = handlers.get('llm_output');
    const end = handlers.get('agent_end');
    output({ content: 'slow payload one' }, { sessionKey: 'one' });
    output({ content: 'slow payload two' }, { sessionKey: 'two' });
    output({ content: 'overflow payload must not be retained' }, { sessionKey: 'three' });
    const first = end({}, { sessionKey: 'one' });
    const coalesced = end({ result: 'slow payload one' }, { sessionKey: 'one' });
    const second = end({}, { sessionKey: 'two' });
    const rejected = end({}, { sessionKey: 'three' });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 2, 'exactly the configured unique-work cap starts');
    assert.equal(await rejected, undefined, 'hook handles deterministic admission rejection');
    assert.equal(warnings.length, 1);
    releases.shift()();
    await Promise.all([first, coalesced]);

    output({ content: 'fresh retry payload' }, { sessionKey: 'three' });
    const retry = end({}, { sessionKey: 'three' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 3, 'cleanup releases one admission slot');
    assert.match(requests[2].content, /fresh retry payload/);
    assert.doesNotMatch(requests[2].content, /overflow payload/);
    releases.splice(0).forEach((release) => release());
    await Promise.all([second, retry]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('parallel declared-size rejections do not await stalled body cancellation', async () => {
  let searchTool;
  const cancellations = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const cancellation = { called: false };
    cancellations.push(cancellation);
    return {
      ok: true,
      headers: new Headers({ 'content-length': '65' }),
      body: {
        async cancel() {
          cancellation.called = true;
          await new Promise(() => {});
        },
      },
    };
  };
  try {
    plugin.register({
      pluginConfig: { maxResponseBytes: 64, retryCount: 0 },
      logger: { info() {}, warn() {} },
      on() {},
      registerMemoryRuntime() {},
      registerTool(factory, options) {
        if (options?.names?.includes('memory_search')) searchTool = factory();
      },
    });

    const results = await Promise.all([
      searchTool.execute('oversized-1', { query: 'first request' }),
      searchTool.execute('oversized-2', { query: 'second request' }),
    ]);

    assert.equal(cancellations.length, 2);
    assert.ok(cancellations.every(({ called }) => called), 'each rejected response body is canceled');
    for (const result of results) {
      assert.match(JSON.parse(result).error, /response exceeds 64 bytes/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('canonical project-status summaries score as durable project state', () => {
  const text = `Mailchimp remediated-run takeaway: trustworthy partial result. Current canonical status: supervisorStatus: red, matrixStatus: partial, parityStatus: partial, blocker: null. Remaining surfaces: C_data_model_and_persistence_parity, E_reporting_analytics_parity. Persistence first. Reply-anchor context should be treated as primary.`;
  const dur = durabilityScore(text);

  assert.equal(dur.kind, 'project_state');
  assert.ok(dur.score >= 0.78, `expected score >= 0.78, got ${dur.score}`);
  assert.match(dur.reasons.join(','), /canonical_project_status/);
  assert.match(dur.reasons.join(','), /named_project/);
});

test('write-through metadata marks canonical project state as curated project facts', () => {
  const cfg = {
    writeTags: ['durable-memory', 'auto-curated', 'cortex-upgrade'],
  };
  const ctx = { channelId: 'whatsapp', sessionKey: 'sess-mailchimp' };
  const text = `Mailchimp current canonical status: supervisorStatus: red, matrixStatus: partial, parityStatus: partial. Remaining surfaces: C_data_model_and_persistence_parity.`;
  const dur = durabilityScore(text);
  const metadata = buildWriteThroughMetadata(cfg, ctx, text, dur);

  assert.equal(metadata.source, 'curated-project-facts');
  assert.equal(metadata.project, 'mailchimp');
  assert.equal(metadata.topic, 'mailchimp-canonical-status');
  assert.ok(metadata.tags.includes('mailchimp'));
  assert.ok(metadata.tags.includes('canonical_project_status'));
});

test('ephemeral chat stays below durability threshold', () => {
  const text = 'ok thanks lol';
  const dur = durabilityScore(text);
  assert.equal(dur.kind, 'transient');
  assert.ok(dur.score < 0.78);
});

test('preference recall ranks explicit reply-prefix memory above codec open loops', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'What should replies begin with for Jake?',
    [
      {
        id: 'loop-1',
        text: 'Open loops: What did Jake ask me to prefix replies with? What did Jake ask me to prefix replies with?',
        distance: 0.05,
        metadata: {
          type: 'codec_state',
          tags: ['cortex_codec', 'codec_state', 'durable_memory'],
          source: 'chroma_docs',
        },
      },
      {
        id: 'pref-1',
        text: 'Jake prefers replies to begin with [Cortex].',
        distance: 0.08,
        metadata: {
          type: 'codec_state',
          tags: ['cortex_codec', 'codec_state', 'durable_memory'],
        },
      },
    ],
    cfg,
  );

  assert.equal(results.results[0].citation, 'cortex:pref-1');
  assert.match(results.results[0].snippet, /\[Cortex\]/);
});

test('preference recall demotes question-echo codec summaries below explicit fact rows', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'What should replies begin with for Jake?',
    [
      {
        id: 'loop-1',
        text: 'Open loops: What did Jake ask me to prefix replies with? What did Jake ask me to prefix replies with?',
        distance: 0.05,
        metadata: { type: 'codec_state', tags: ['cortex_codec', 'codec_state', 'durable_memory'], source: 'chroma_docs' },
      },
      {
        id: 'loop-2',
        text: 'Projects: regression-safe | Goals: Implement a regression-safe fix and validate it with tests. | Open loops: What did Jake ask me to prefix replies with?',
        distance: 0.05,
        metadata: { type: 'codec_state', tags: ['cortex_codec', 'codec_state', 'durable_memory'], source: 'chroma_docs' },
      },
      {
        id: 'pref-1',
        text: 'Jake prefers replies to begin with [Cortex]. Projects: Cortex Codec, Jake, Nexus | Goals: Build the Cortex Codec into Nexus and OpenClaw.',
        distance: 0.08,
        metadata: { type: 'codec_state', tags: ['cortex_codec', 'codec_state', 'durable_memory'] },
      },
    ],
    cfg,
  );

  assert.equal(results.results[0].citation, 'cortex:pref-1');
  assert.ok(results.results[0].score > results.results[1].score);
});

test('reconciliation broadly ranks fresh corrected facts above stale negative rows', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'Nexus webhook bridge implemented verified',
    [
      {
        id: 'old-negative',
        text: 'Could not find any evidence that the Nexus webhook bridge was implemented or verified.',
        distance: 0.01,
        score: 0.84,
        metadata: { source: 'local_file_memory', quality: 'curated', stale_negative_memory: true },
      },
      {
        id: 'fresh-current',
        text: 'Current canonical status: Nexus webhook bridge implemented, synced, and live verification tests passed.',
        distance: 0.9,
        score: 1,
        metadata: { source: 'local_file_memory', quality: 'curated', correction_memory: true },
      },
    ],
    cfg,
  );

  assert.equal(results.results[0].citation, 'cortex:fresh-current');
  assert.ok(!results.results.some((row) => row.citation === 'cortex:old-negative'));
});

test('negative-evidence queries preserve missing/not-found rows', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'what was missing for Nexus webhook bridge',
    [
      {
        id: 'old-negative',
        text: 'Could not find any evidence that the Nexus webhook bridge was implemented or verified.',
        distance: 0.01,
        score: 0.84,
        metadata: { source: 'local_file_memory', quality: 'curated', stale_negative_memory: true },
      },
      {
        id: 'fresh-current',
        text: 'Current canonical status: Nexus webhook bridge implemented, synced, and live verification tests passed.',
        distance: 0.9,
        score: 1,
        metadata: { source: 'local_file_memory', quality: 'curated', correction_memory: true },
      },
    ],
    cfg,
  );

  assert.ok(results.results.some((row) => row.citation === 'cortex:old-negative'));
});

test('implemented orchestration facts beat older implement-next-action rows', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'agent orchestration objective expansion generic repair loop',
    [
      {
        id: 'older-plan',
        text: 'Next action: implement the generic objective expansion repair loop in agent orchestration.',
        distance: 0.02,
        score: 0.92,
        metadata: { source: 'local_file_memory', quality: 'curated' },
      },
      {
        id: 'implemented-fact',
        text: 'Generic objective-truth repair loop implemented and synced to Hetzner in the shared agent-orchestration layer.',
        distance: 0.8,
        score: 1,
        metadata: { source: 'local_file_memory', quality: 'curated', correction_memory: true },
      },
    ],
    cfg,
  );

  assert.equal(results.results[0].citation, 'cortex:implemented-fact');
  assert.ok(!results.results.some((row) => row.citation === 'cortex:older-plan'));
});

test('memory-system repair notes do not outrank domain facts for domain queries', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'Morgan correspondence SimplePractice NPI billing provider',
    [
      {
        id: 'meta-fix',
        text: 'Live verification: memory_search("Morgan correspondence SimplePractice NPI billing provider") now returns pmhnp-billing correction rows first. Regression coverage added in test_librarian_recall_fallback.py.',
        score: 1,
        metadata: { source: 'local_file_memory' },
      },
      {
        id: 'domain-fact',
        text: 'BCBS SimplePractice enrollment/NPI truth corrected: use Harbor Behavioral Health PLLC organization NPI 2 and PLLC EIN as billing provider, with Morgan individual NPI 1 as rendering provider.',
        score: 0.95,
        metadata: { source: 'local_file_memory', quality: 'curated', correction_memory: true },
      },
    ],
    cfg,
  );

  assert.equal(results.results[0].citation, 'cortex:domain-fact');
  assert.ok(!results.results.some((row) => row.citation === 'cortex:meta-fix'));
});

test('explicit supersession is hidden for current queries and retained for historical queries', () => {
  const cfg = {
    curatedBoost: 0.24, projectFactBoost: 0.12, durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26, noisyPatternPenalty: 0.2, conflictPenalty: 0.18,
    recencyBoost: 0.12, explicitBoost: 0.14, corroborationBoost: 0.08, hardQueryCandidateCount: 12,
  };
  const rows = [
    { id: 'old', text: 'Agent Work needs its first product dogfood.', score: 1, metadata: { memory_status: 'superseded' } },
    { id: 'new', text: 'Agent Work product dogfood is already proven.', score: 0.8, metadata: { memory_status: 'active', authority_rank: 90, correction_memory: true } },
  ];
  const current = reconcileResults('What is the current Agent Work dogfood status?', rows, cfg);
  assert.deepEqual(current.results.map((row) => row.citation), ['cortex:new']);
  const history = reconcileResults('Show historical superseded Agent Work dogfood memory', rows, cfg);
  assert.ok(history.results.some((row) => row.citation === 'cortex:old'));
});
