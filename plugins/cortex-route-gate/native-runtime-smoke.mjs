import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import register from './index.ts';
import { cortexOpenClawCompatibilityMetadata } from './compat/openclaw-2026.7.ts';
import {
  CORTEX_TURN_LIFECYCLE_CONTRACT,
  cortexTurnLifecycle,
} from './compat/cortex-turn-lifecycle.ts';

const fixture = JSON.parse(fs.readFileSync(
  new URL('./nexus-orchestrate-response.fixture.json', import.meta.url),
  'utf8',
));
const metadata = cortexOpenClawCompatibilityMetadata();
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-openclaw-runtime-smoke-'));
const handlers = new Map();
const logLines = [];
let toolRegistered = false;
let nexusCalls = 0;
const sessionKey = 'agent:main:smoke:cortex-openclaw-runtime';
const runId = 'native-runtime-smoke-run-1';
const context = {
  runId,
  sessionKey,
  sessionId: 'native-runtime-smoke-session',
  agentId: 'main',
  userId: 'smoke-user',
  channelId: 'smoke',
  accountId: 'default',
  messageId: 'smoke-message-1',
};
const sessionSecret = 'cortex-openclaw-runtime-smoke-session-secret';
const originalFetch = globalThis.fetch;
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: path.dirname(new URL(import.meta.url).pathname),
  encoding: 'utf8',
}).trim();

globalThis.fetch = async (url) => {
  const pathname = new URL(String(url)).pathname;
  if (pathname === '/knowledge/search') {
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (pathname === '/nexus/orchestrate') {
    nexusCalls += 1;
    return new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error(`unexpected smoke request: ${pathname}`);
};

try {
  cortexTurnLifecycle.reset();
  register({
    pluginConfig: {
      enabled: true,
      requireRouting: true,
      baseUrl: 'http://127.0.0.1:18888',
      timeoutMs: 2_000,
      routeCacheHmacSecret: 'cortex-openclaw-runtime-smoke-cache-secret',
      sessionIdentityHmacSecret: sessionSecret,
      agentId: context.agentId,
      userId: context.userId,
      channelId: context.channelId,
      writeToken: 'cortex-openclaw-runtime-smoke-write-token',
      scopeCredentialId: 'cortex-openclaw-runtime-smoke',
      scopeHmacSecret: 'cortex-openclaw-runtime-smoke-scope-secret',
      stateDir,
      oracleConsultEnabled: false,
      oracleSemanticRoutingEnabled: false,
      levelExecutionEnabled: false,
      oracleCodecContextEnabled: false,
      creativityGovernorEnabled: false,
      privateRetrievalShadowTelemetryEnabled: false,
    },
    logger: {
      info(message) { logLines.push(`info:${message}`); },
      warn(message) { logLines.push(`warn:${message}`); },
    },
    on(name, handler) {
      assert.equal(typeof handler, 'function');
      handlers.set(name, handler);
    },
    registerTool(factory) {
      assert.equal(typeof factory, 'function');
      toolRegistered = true;
    },
    sendUserMessage() {},
  });

  assert.equal(metadata.schemaVersion, 'cortex.openclaw.compat.v1');
  assert.equal(metadata.adapterVersion, '1.3.0');
  assert.equal(metadata.turnLifecycleContract, CORTEX_TURN_LIFECYCLE_CONTRACT);
  assert.equal(metadata.testedOpenClaw.version, '2026.7.1-2');
  assert.deepEqual([...handlers.keys()], [...metadata.requiredHooks]);
  assert.equal(toolRegistered, true);
  assert.ok(logLines.some((line) => line.includes('registered cortex.openclaw.compat.v1')));

  const prompt = 'Should I deploy this change to production? Use the observed evidence and be explicit about uncertainty.';
  const promptResult = await handlers.get('before_prompt_build')(
    { prompt, messages: [{ role: 'user', content: prompt }] },
    context,
  );
  assert.match(String(promptResult?.appendSystemContext || ''), /CORTEX_ROUTE_GATE/);
  assert.match(String(promptResult?.appendSystemContext || ''), /CORTEX_DAILY_WORK_CONTRACT/);
  assert.equal(nexusCalls, 1);

  const unsupported = await handlers.get('before_agent_finalize')(
    {
      runId,
      sessionId: context.sessionId,
      sessionKey: context.sessionKey,
      stopHookActive: false,
      lastAssistantMessage: 'I verified the production deployment is safe.',
    },
    context,
  );
  assert.equal(unsupported?.action, 'revise');
  assert.match(unsupported?.reason || '', /usable_evidence_count: 0/);
  assert.match(unsupported?.retry?.instruction || '', /CORTEX_EVIDENCE_BINDING_REVISION_REQUIRED/);
  assert.equal(unsupported?.retry?.maxAttempts, 1);
  assert.match(unsupported?.retry?.idempotencyKey || '', /^cortex-evidence-binding:/);
  assert.equal('additionalSystemPrompt' in unsupported, false);

  const retryPrompt = String(unsupported?.reason || 'Revise with evidence.');
  const retryPromptResult = await handlers.get('before_prompt_build')(
    { prompt: retryPrompt, messages: [{ role: 'user', content: retryPrompt }] },
    context,
  );
  assert.match(String(retryPromptResult?.appendSystemContext || ''), /CORTEX_RUN_ATTEMPT_CONTINUITY/);
  assert.match(String(retryPromptResult?.appendSystemContext || ''), /prompt_attempt: 2/);
  assert.match(String(retryPromptResult?.appendSystemContext || ''), /revision_requests: 1/);
  assert.equal(nexusCalls, 1);

  await handlers.get('before_tool_call')(
    { toolName: 'memory_search', toolCallId: 'smoke-tool-1' },
    context,
  );
  await handlers.get('after_tool_call')(
    {
      toolName: 'memory_search',
      toolCallId: 'smoke-tool-1',
      durationMs: 1,
      result: { content: [{ type: 'text', text: 'Focused smoke evidence is available.' }] },
    },
    context,
  );
  const persisted = handlers.get('tool_result_persist')(
    { toolName: 'memory_search', message: { role: 'tool', content: 'Focused smoke evidence is available.' } },
    context,
  );
  assert.match(String(persisted?.message?.content || ''), /CORTEX_TOOL_RESULT_METADATA/);

  await handlers.get('llm_output')(
    { assistantTexts: ['Recommendation: proceed only with the observed focused-smoke evidence and retain rollback.'] },
    context,
  );
  await handlers.get('agent_end')({ runId, success: true }, context);
  const deliveryContext = { ...context };
  delete deliveryContext.runId;
  const delivery = await handlers.get('message_sending')(
    { to: 'smoke-destination', content: 'Recommendation: proceed only with the observed focused-smoke evidence and retain rollback.' },
    deliveryContext,
  );
  assert.notEqual(delivery?.cancel, true);
  handlers.get('message_sent')({}, deliveryContext);

  const firstTurnReceipt = cortexTurnLifecycle.getLatestCompleted();
  assert.equal(cortexTurnLifecycle.getActiveCount(), 0);
  assert.equal(cortexTurnLifecycle.getCompletedCount(), 1);
  assert.equal(firstTurnReceipt?.contract, CORTEX_TURN_LIFECYCLE_CONTRACT);
  assert.equal(firstTurnReceipt?.runId, runId);
  assert.equal(firstTurnReceipt?.phase, 'completed');
  assert.equal(firstTurnReceipt?.toolDepth, 0);
  assert.equal(firstTurnReceipt?.attempts.prompts, 2);
  assert.equal(firstTurnReceipt?.attempts.finalizations, 1);
  assert.equal(firstTurnReceipt?.attempts.revisions, 1);
  assert.equal(firstTurnReceipt?.observed.prompt, true);
  assert.equal(firstTurnReceipt?.observed.toolCall, true);
  assert.equal(firstTurnReceipt?.observed.toolResult, true);
  assert.equal(firstTurnReceipt?.observed.persistedToolResult, true);
  assert.equal(firstTurnReceipt?.observed.output, true);
  assert.equal(firstTurnReceipt?.observed.finalization, true);
  assert.equal(firstTurnReceipt?.observed.deliveryStart, true);
  assert.equal(firstTurnReceipt?.observed.deliveryComplete, true);
  assert.equal(firstTurnReceipt?.observed.agentEnd, true);
  assert.equal(firstTurnReceipt?.success, true);

  const secondContext = { ...context, runId: 'native-runtime-smoke-run-2', messageId: 'smoke-message-2' };
  await handlers.get('before_prompt_build')(
    { prompt, messages: [{ role: 'user', content: prompt }] },
    secondContext,
  );
  assert.equal(nexusCalls, 1);
  const isolatedRevision = await handlers.get('before_agent_finalize')(
    { runId: secondContext.runId, sessionId: secondContext.sessionId, sessionKey, stopHookActive: false, lastAssistantMessage: 'I verified the production deployment is safe.' },
    secondContext,
  );
  assert.equal(isolatedRevision?.action, 'revise');
  assert.match(isolatedRevision?.reason || '', /usable_evidence_count: 0/);
  await handlers.get('agent_end')({ runId: secondContext.runId, success: true }, secondContext);
  handlers.get('message_sent')({}, { ...secondContext, runId: undefined });
  const secondTurnReceipt = cortexTurnLifecycle.getLatestCompleted();
  assert.equal(cortexTurnLifecycle.getActiveCount(), 0);
  assert.equal(cortexTurnLifecycle.getCompletedCount(), 2);
  assert.equal(secondTurnReceipt?.runId, secondContext.runId);
  assert.equal(secondTurnReceipt?.attempts.prompts, 1);
  assert.equal(secondTurnReceipt?.attempts.revisions, 1);

  const receipt = {
    schemaVersion: 'cortex.openclaw.runtime-smoke.v1',
    status: 'passed',
    adapter: metadata,
    sourceCommit,
    registeredHooks: [...handlers.keys()],
    checks: {
      routeContextInjected: true,
      unsupportedClaimRevisionRequested: true,
      toolEvidenceObserved: true,
      toolPersistenceProjected: true,
      outputObserved: true,
      deliveryPreserved: true,
      agentEndClearedInflightState: true,
      cortexTurnLifecycleReceiptCompleted: true,
      cortexTurnLifecycleActiveStateCleared: true,
      sameRunRetryContinuityPreserved: true,
      retryRouteNotRecomputed: true,
      principalPlanReusePreservedAcrossRuns: true,
      newRunEvidenceIsolationPreserved: true,
    },
    turnLifecycle: {
      firstRun: firstTurnReceipt,
      isolatedSecondRun: secondTurnReceipt,
    },
  };
  const receiptPath = '/root/clawd/cortex-openclaw-runtime/artifacts/native-runtime-smoke.json';
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(`CORTEX_OPENCLAW_RUNTIME_SMOKE PASS receipt=${receiptPath}`);
} finally {
  globalThis.fetch = originalFetch;
  fs.rmSync(stateDir, { recursive: true, force: true });
}
