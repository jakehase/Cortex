import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLlmMeteringMode,
  envFromLlmMeteringPlan,
  normalizeTokenBudgetMode,
  resolveLlmMeteringAdapter
} from '../packages/llm-metering-adapter/index.mjs';

test('metering adapter detects explicit OAuth/message mode and bundles logical surfaces into fewer Codex messages', () => {
  const plan = resolveLlmMeteringAdapter({
    env: {
      CONTINUOUS_CONTROLLER_METERING_MODE: 'oauth',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '30',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '120000',
      CREATIVE_WORKER_CONTEXT_TOTAL_MAX_CHARS: '16000'
    },
    requestedAgentCount: 50,
    selectedLogicalSurfaceCount: 50,
    requestedBundleSize: 1,
    waveMaxAttemptsPerTask: 2,
    promptMode: 'compact',
    compactBriefMaxChars: 12000,
    inheritedWaveTokenLimit: 80_000_000,
    hasCodexAuthFile: false
  });

  assert.equal(plan.mode, 'oauth_message_metered');
  assert.equal(plan.budgetAxis, 'messages');
  assert.equal(plan.tokenBudgetMode, 'safety');
  assert.equal(plan.adaptiveTokenBudgetEnabled, false);
  assert.equal(plan.effectiveBundleSize, 5);
  assert.equal(plan.estimatedPhysicalCallCount, 10);
  assert.equal(plan.perWorkerCallLimit, 1);
  assert.ok(plan.globalCallLimit >= 10 && plan.globalCallLimit < 50);
  assert.equal(plan.activeCodexCallCap, 10);
  assert.ok(plan.compactBriefMaxChars >= 36000);
  assert.ok(plan.contextTotalMaxChars >= 48000);

  const env = envFromLlmMeteringPlan(plan, { physicalWorkerCount: 10 });
  assert.equal(env.CREATIVE_WORKER_METERING_MODE, 'oauth_message_metered');
  assert.equal(env.CREATIVE_WORKER_TOKEN_BUDGET_MODE, 'safety');
  assert.equal(env.ORCHESTRATOR_MAX_ATTEMPTS_PER_TASK, '1');
  assert.equal(env.CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT, '1');
  assert.equal(env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS, '10');
  assert.equal(env.CREATIVE_WORKER_COMPACT_FAIL_CLOSED, '0');
  assert.equal(JSON.parse(env.CREATIVE_WORKER_METERING_PLAN).actualPhysicalWorkerCount, 10);
});

test('metering adapter keeps API-token mode token-hard and unbundled by default', () => {
  const detected = detectLlmMeteringMode({ env: { OPENAI_API_KEY: 'present' }, hasCodexAuthFile: true });
  assert.equal(detected.mode, 'api_token_metered');

  const plan = resolveLlmMeteringAdapter({
    env: { OPENAI_API_KEY: 'present', CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '8' },
    requestedAgentCount: 50,
    selectedLogicalSurfaceCount: 50,
    requestedBundleSize: 1,
    waveMaxAttemptsPerTask: 2,
    promptMode: 'compact',
    compactBriefMaxChars: 9000,
    tokenReservationEstimate: 80_000,
    hasCodexAuthFile: true
  });

  assert.equal(plan.mode, 'api_token_metered');
  assert.equal(plan.budgetAxis, 'tokens');
  assert.equal(plan.tokenBudgetMode, 'hard');
  assert.equal(plan.adaptiveTokenBudgetEnabled, true);
  assert.equal(plan.effectiveBundleSize, 1);
  assert.equal(plan.estimatedPhysicalCallCount, 50);
  assert.equal(plan.perWorkerCallLimit, 2);
  assert.equal(plan.globalCallLimit, 100);
  assert.equal(plan.activeCodexCallCap, 8);
  assert.equal(normalizeTokenBudgetMode('', { meteringMode: plan.mode }), 'hard');
});

test('metering adapter can be forced to unknown hybrid without inventing OAuth behavior', () => {
  const plan = resolveLlmMeteringAdapter({
    env: { LLM_METERING_MODE: 'hybrid' },
    requestedAgentCount: 12,
    selectedLogicalSurfaceCount: 12,
    requestedBundleSize: 2,
    waveMaxAttemptsPerTask: 2,
    promptMode: 'compact',
    compactBriefMaxChars: 8000,
    hasCodexAuthFile: false
  });

  assert.equal(plan.mode, 'hybrid_unknown');
  assert.equal(plan.tokenBudgetMode, 'hard');
  assert.equal(plan.effectiveBundleSize, 2);
  assert.equal(plan.adaptiveTokenBudgetEnabled, true);
});
