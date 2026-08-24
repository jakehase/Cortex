import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import bridgePlugin, {
  canonicalChannelIdentity,
  durabilityScore,
  buildWriteThroughMetadata,
  reconcileResults,
  extractLatestAssistantVisibleText,
  extractLlmOutputText,
} from './index.ts';

const profitTournamentCorrection = `[Cortex] On July 21, you authorized the separate Profit Tournament Market Stripe account. We later verified that charges and payouts were enabled. I confused missing Hetzner credentials with a missing account and was wrong. The durable project record is corrected. Install the restricted API key and webhook secret through the secure deployment path; creating another account is not required.`;
const websiteDesignCompletion = `Good progress—the mechanical foundation is complete and saved. Commit: 5a6a85817. 37 files changed; remote worktree is clean. Focused tests: 32/32 passed. Validation, replay, freeze, report, schema parsing, and safety scans passed. Not pushed or deployed; no PMHNP production changes. Honest capability status remains implemented, unqualified: there are still no live verified exemplars, promoted real-world lessons, or held-out assessments. Next phase: build the verified design corpus, promote evidence-backed lessons, then run blinded baseline-versus-treatment assessments.`;

function lifecycleConfig(stateDir) {
  return {
    baseUrl: 'http://127.0.0.1:8000',
    enabledWriteThrough: true,
    enabledCodecContinuity: false,
    minDurabilityScore: 0.64,
    stateDir,
    sessionIdentityHmacSecret: 'test-session-identity-hmac-secret',
    scopeCredentialId: 'test-scope-credential',
    scopeHmacSecret: 'test-scope-hmac-secret',
    writeToken: 'test-write-token',
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function lifecycleFetch(calls, delayMs = 0) {
  return async (url, options) => {
    const route = new URL(String(url)).pathname;
    const body = JSON.parse(String(options?.body || '{}'));
    const call = { url: String(url), route, body, completed: false };
    calls.push(call);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    let response;
    if (route === '/nexus/assurance/receipt') {
      response = jsonResponse({ success: true, receipt: 'test-assurance-receipt' });
    } else if (route === '/nexus/commit') {
      response = jsonResponse({
        success: true,
        committed: true,
        durable_write: { status: 'stored', id: 'test-memory-id' },
        assurance: {
          memory_commit: { eligible: true },
          receipt: { id: 'test-receipt-id' },
        },
        acknowledgement: {
          version: 'nexus.memory-commit-ack.v1',
          status: 'committed',
          memory_id: 'test-memory-id',
          receipt_id: 'test-receipt-id',
        },
      });
    } else if (route === '/knowledge/search') {
      response = jsonResponse({ results: [{ id: 'test-memory-id', text: body.query, metadata: {} }] });
    } else {
      throw new Error(`unexpected bridge route ${route}`);
    }
    call.completed = true;
    return response;
  };
}

async function waitFor(predicate, description) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${description}`);
}

test('canonical Cortex channel scope uses the logical transport instead of a raw WhatsApp address', () => {
  const cfg = { channelId: 'whatsapp' };
  assert.equal(
    canonicalChannelIdentity(cfg, { messageChannel: 'whatsapp', channelId: '+15551234567' }),
    'whatsapp',
  );
  assert.equal(canonicalChannelIdentity(cfg, { channelId: '+15551234567' }), 'whatsapp');
});

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

test('generic committed, tested, clean checkpoints with remaining-work boundaries are durable', () => {
  const text = 'Changes were committed and tested successfully. The remote worktree is clean. Remaining work: deploy after review.';
  const dur = durabilityScore(text);
  const metadata = buildWriteThroughMetadata(
    { writeTags: ['durable-memory', 'auto-curated'] },
    { channelId: 'whatsapp', sessionKey: 'generic-completion' },
    text,
    dur,
  );

  assert.equal(dur.kind, 'completion_state');
  assert.ok(dur.score >= 0.64, `expected generic checkpoint >= 0.64, got ${dur.score}`);
  assert.ok(dur.reasons.includes('durable_completion_checkpoint'));
  assert.ok(dur.reasons.includes('remaining_work_boundary'));
  assert.equal(metadata.source, 'openclaw-completion-candidate');
  assert.equal(metadata.project, undefined);
  assert.equal(metadata.fact_key, undefined);

  const negated = durabilityScore('No changes were committed. Focused tests passed, and the worktree is clean. Remaining work: implement the checkpoint.');
  assert.ok(negated.score < 0.64, `expected negated commit boundary below threshold, got ${negated.score}`);
  assert.ok(!negated.reasons.includes('durable_completion_checkpoint'));
});

test('sanitized website completion is durable and a negated PMHNP boundary is not a project assignment', () => {
  const dur = durabilityScore(websiteDesignCompletion);
  const metadata = buildWriteThroughMetadata(
    { writeTags: ['durable-memory', 'auto-curated'] },
    { channelId: 'whatsapp', sessionKey: 'website-completion' },
    websiteDesignCompletion,
    dur,
  );

  assert.equal(dur.kind, 'completion_state');
  assert.ok(dur.score >= 0.72, `expected sanitized completion >= 0.72, got ${dur.score}`);
  assert.ok(dur.reasons.includes('deployment_boundary'));
  assert.equal(metadata.project, undefined);
  assert.ok(!metadata.tags.includes('pmhnp-claim-guard'));

  for (const negativeBoundary of [
    'No PMHNP production changes were made during this run.',
    'No production changes were made to PMHNP during this run.',
    'This work does not affect PMHNP production.',
    'PMHNP was not changed by this checkpoint.',
    'PMHNP had no changes during this checkpoint.',
  ]) {
    const negativeMetadata = buildWriteThroughMetadata(
      { writeTags: ['durable-memory'] },
      { channelId: 'whatsapp', sessionKey: 'pmhnp-negative' },
      negativeBoundary,
      durabilityScore(negativeBoundary),
    );
    assert.equal(negativeMetadata.project, undefined, negativeBoundary);
  }

  const affirmedText = 'The PMHNP claim guard project setup is the active architecture for this checkpoint.';
  const affirmedMetadata = buildWriteThroughMetadata(
    { writeTags: ['durable-memory'] },
    { channelId: 'whatsapp', sessionKey: 'pmhnp-positive' },
    affirmedText,
    durabilityScore(affirmedText),
  );
  assert.equal(affirmedMetadata.project, 'pmhnp-claim-guard');
});

test('Learning OS and website-design aliases produce useful project metadata', () => {
  const websiteText = 'The professional website-design learning checkpoint is complete. Changes were committed, focused tests passed, and the worktree is clean.';
  const websiteDur = durabilityScore(websiteText);
  const websiteMetadata = buildWriteThroughMetadata(
    { writeTags: ['durable-memory'] },
    { channelId: 'whatsapp', sessionKey: 'website-learning' },
    websiteText,
    websiteDur,
  );
  assert.equal(websiteMetadata.project, 'learning-os-website-design');
  assert.ok(websiteMetadata.tags.includes('learning-os-website-design'));

  const learningOsText = 'The Cortex Learning OS architecture is the durable project setup for lesson promotion.';
  const learningOsMetadata = buildWriteThroughMetadata(
    { writeTags: ['durable-memory'] },
    { channelId: 'whatsapp', sessionKey: 'learning-os' },
    learningOsText,
    durabilityScore(learningOsText),
  );
  assert.equal(learningOsMetadata.project, 'cortex-learning-os');
});

test('agent_end defers persistence and captures following llm_output instead of stale transcript content', async () => {
  const hooks = {};
  const calls = [];
  const stateDir = mkdtempSync(path.join(tmpdir(), 'cortex-bridge-test-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = lifecycleFetch(calls);
  try {
    bridgePlugin.register({
      pluginConfig: lifecycleConfig(stateDir),
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
    hooks.llm_output({ runId: 'run-current-shape', assistantTexts: [websiteDesignCompletion], lastAssistant: {} }, ctx);
    assert.equal(agentEnd, undefined);
    await waitFor(() => calls.some((call) => call.route === '/knowledge/search' && call.completed), 'retrieval-confirmed lifecycle persistence');

    assert.deepEqual(calls.map((call) => call.route), [
      '/nexus/assurance/receipt',
      '/nexus/commit',
      '/knowledge/search',
    ]);
    const commit = calls.find((call) => call.route === '/nexus/commit');
    assert.equal(commit.body.response, websiteDesignCompletion.replace(/\s+/g, ' ').trim());
    assert.equal(commit.body.metadata.source, 'openclaw-completion-candidate');
    assert.equal(commit.body.metadata.project, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('agent_end does not persist stale transcript content when correlated llm_output never arrives', async () => {
  const hooks = {};
  const calls = [];
  const stateDir = mkdtempSync(path.join(tmpdir(), 'cortex-bridge-test-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = lifecycleFetch(calls);
  try {
    bridgePlugin.register({
      pluginConfig: lifecycleConfig(stateDir),
      logger: { info() {}, warn() {} }, registerMemoryRuntime() {}, registerTool() {}, on(name, handler) { hooks[name] = handler; },
    });
    const ctx = { runId: 'stale-run-1', sessionId: 'stale-session', sessionKey: 'stale-session', channelId: 'whatsapp' };
    hooks.agent_end({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Old durable project configuration that must not be stored.' }] }] }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('subagent_ended and agent_end coalesce one correlated lifecycle persistence', async () => {
  const hooks = {};
  const calls = [];
  const stateDir = mkdtempSync(path.join(tmpdir(), 'cortex-bridge-test-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = lifecycleFetch(calls, 10);
  try {
    bridgePlugin.register({
      pluginConfig: lifecycleConfig(stateDir),
      logger: { info() {}, warn() {} }, registerMemoryRuntime() {}, registerTool() {}, on(name, handler) { hooks[name] = handler; },
    });
    const ctx = { runId: 'shared-run', sessionId: 'shared-session', sessionKey: 'shared-session', channelId: 'whatsapp' };
    hooks.llm_output({ runId: 'shared-run', assistantTexts: [profitTournamentCorrection] }, ctx);
    hooks.subagent_ended({ runId: 'shared-run', outcome: 'ok' }, ctx);
    hooks.agent_end({ runId: 'shared-run', success: true }, ctx);
    await waitFor(() => calls.some((call) => call.route === '/knowledge/search' && call.completed), 'coalesced lifecycle persistence');
    assert.deepEqual(calls.map((call) => call.route), [
      '/nexus/assurance/receipt',
      '/nexus/commit',
      '/knowledge/search',
    ]);
    assert.equal(calls.find((call) => call.route === '/nexus/commit').body.response, profitTournamentCorrection.replace(/\s+/g, ' ').trim());
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(stateDir, { recursive: true, force: true });
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
        text: 'Live verification: memory_search("Morgan correspondence SimplePractice NPI billing provider") now returns billing correction rows first. Regression coverage added in test_librarian_recall_fallback.py.',
        score: 1,
        metadata: { source: 'local_file_memory' },
      },
      {
        id: 'domain-fact',
        text: 'Synthetic BCBS SimplePractice enrollment/NPI truth corrected: use Harbor Behavioral Health PLLC organization NPI 2 and synthetic organization EIN as billing provider, with Morgan individual NPI 1 as rendering provider.',
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
