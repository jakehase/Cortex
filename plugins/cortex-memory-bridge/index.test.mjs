import test from 'node:test';
import assert from 'node:assert/strict';

import bridgePlugin, {
  durabilityScore,
  buildWriteThroughMetadata,
  reconcileResults,
  extractLatestAssistantVisibleText,
  extractLlmOutputText,
} from './index.ts';

const profitTournamentCorrection = `[Cortex] On July 21, you authorized the separate Profit Tournament Market Stripe account. We later verified that charges and payouts were enabled. I confused missing Hetzner credentials with a missing account and was wrong. The durable project record is corrected. Install the restricted API key and webhook secret through the secure deployment path; creating another account is not required.`;

test('current OpenClaw assistant content shape extracts visible text and skips thinking', () => {
  const messages = [
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal', thinkingSignature: 'sig' }, { type: 'text', text: 'older answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'follow-up' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal', thinkingSignature: 'sig' }, { type: 'text', text: profitTournamentCorrection }] },
  ];
  assert.equal(extractLatestAssistantVisibleText(messages), profitTournamentCorrection);
});

test('llm_output falls back to lastAssistant when assistantTexts is empty', () => {
  const event = {
    assistantTexts: [],
    lastAssistant: { role: 'assistant', content: [{ type: 'text', text: profitTournamentCorrection }] },
  };
  assert.equal(extractLlmOutputText(event), profitTournamentCorrection);
});

test('safe discussion of credential installation is durable but concrete secret values are blocked', () => {
  const safe = durabilityScore(profitTournamentCorrection);
  assert.ok(safe.score >= 0.64, `expected safe correction >= 0.64, got ${safe.score}`);
  assert.ok(!safe.reasons.includes('secret_like'));

  const unsafe = durabilityScore('Profit Tournament API key=sk_live_ABC123456789 was configured and verified.');
  assert.equal(unsafe.score, 0);
  assert.ok(unsafe.reasons.includes('secret_like'));
});

test('agent_end waits for the following llm_output and stores only the latest reply', async () => {
  const hooks = {};
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(String(options?.body || '{}')) });
    return { ok: true, json: async () => ({ stored: true }) };
  };
  try {
    bridgePlugin.register({
      pluginConfig: {
        baseUrl: 'http://127.0.0.1:8000',
        enabledWriteThrough: true,
        enabledCodecContinuity: false,
        minDurabilityScore: 0.64,
      },
      logger: { info() {}, warn() {} },
      registerMemoryRuntime() {},
      registerTool() {},
      on(name, handler) { hooks[name] = handler; },
    });
    const ctx = { runId: 'run-current-shape', sessionId: 'session-1', sessionKey: 'agent:main:main', channelId: 'whatsapp' };
    const agentEnd = hooks.agent_end({
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'PMHNP old project setup.' }] }],
      success: true,
    }, ctx);
    await hooks.llm_output({ runId: 'run-current-shape', assistantTexts: [profitTournamentCorrection], lastAssistant: {} }, ctx);
    await agentEnd;

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/l22\/store$/);
    assert.equal(calls[0].body.content, profitTournamentCorrection.replace(/\s+/g, ' ').trim());
    assert.equal(calls[0].body.metadata.project, 'profit-tournament');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agent_end refuses stale transcript content when correlated llm_output never arrives', async () => {
  const hooks = {};
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(String(options?.body || '{}')) });
    return { ok: true, json: async () => ({ stored: true }) };
  };
  try {
    bridgePlugin.register({
      pluginConfig: { baseUrl: 'http://127.0.0.1:8000', enabledWriteThrough: true, enabledCodecContinuity: false, minDurabilityScore: 0.64 },
      logger: { info() {}, warn() {} }, registerMemoryRuntime() {}, registerTool() {}, on(name, handler) { hooks[name] = handler; },
    });
    const ctx = { runId: 'stale-run-1', sessionId: 'stale-session', sessionKey: 'stale-session', channelId: 'whatsapp' };
    await assert.rejects(
      hooks.agent_end({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Old durable project configuration that must not be stored.' }] }] }, ctx),
      /refused stale agent_end content/,
    );
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('subagent_ended and agent_end coalesce one correlated lifecycle persistence', async () => {
  const hooks = {};
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(String(options?.body || '{}')) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true, json: async () => ({ stored: true }) };
  };
  try {
    bridgePlugin.register({
      pluginConfig: { baseUrl: 'http://127.0.0.1:8000', enabledWriteThrough: true, enabledCodecContinuity: false, minDurabilityScore: 0.64 },
      logger: { info() {}, warn() {} }, registerMemoryRuntime() {}, registerTool() {}, on(name, handler) { hooks[name] = handler; },
    });
    const ctx = { runId: 'shared-run', sessionId: 'shared-session', sessionKey: 'shared-session', channelId: 'whatsapp' };
    await hooks.llm_output({ runId: 'shared-run', assistantTexts: [profitTournamentCorrection] }, ctx);
    await Promise.all([
      hooks.subagent_ended({ runId: 'shared-run', outcome: 'ok' }, ctx),
      hooks.agent_end({ runId: 'shared-run', success: true }, ctx),
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.content, profitTournamentCorrection.replace(/\s+/g, ' ').trim());
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
