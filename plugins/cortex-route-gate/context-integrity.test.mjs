import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import register from './index.ts';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true,
  headers: new Headers({ 'content-length': '256' }),
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({
        recommended_levels: [
          { level: 24, name: 'Nexus', reason: 'test routing' },
          { level: 5, name: 'Oracle', reason: 'test routing' },
        ],
        routing_method: 'test',
        reasoning: ['test'],
      })));
      controller.close();
    },
  }),
});
test.after(() => { globalThis.fetch = originalFetch; });

function harness() {
  const handlers = new Map();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-context-integrity-'));
  register({
    config: {
      enabled: true,
      requireRouting: true,
      baseUrl: 'http://127.0.0.1:18888',
      timeoutMs: 250,
      maxLevels: 10,
      stateDir,
      tenantId: 'test-tenant',
      workspaceId: 'test-workspace',
      agentId: 'main',
      userId: 'test-user',
      channelId: 'test',
      scopeCredentialId: 'test-scope',
      scopeHmacSecret: 'test-scope-hmac-secret-32-bytes-minimum',
      sessionIdentityHmacSecret: 'test-session-identity-secret-32-bytes-minimum',
      routeCacheHmacSecret: 'test-route-cache-secret-32-bytes-minimum',
      allowUnsignedLocalDevelopment: true,
    },
    logger: { info() {}, warn() {} },
    on(name, fn) { handlers.set(name, fn); },
    sendUserMessage() {},
  });
  return { handlers, stateDir };
}

const sessionKey = 'agent:main:test:direct:owner';
const ctx = { sessionKey, sessionId: 'test-session', agentId: 'main' };

async function promptTurn(h, prompt, messages) {
  return h.handlers.get('before_prompt_build')({ prompt, messages }, ctx);
}

test('exact regression: a compacted additive request recovers and preserves the full report artifact', async () => {
  const h = harness();
  const originalRequest = 'Draft the complete general billing report with BCBS, Medicare, HPHC, Optum, and BBA sections.';
  await promptTurn(h, originalRequest, [{ role: 'user', content: originalRequest }]);
  const report = [
    '**Draft only—not sent**',
    '**Subject: General billing report**',
    '**BCBS**\n- payment update',
    '**Medicare**\n- crossover update',
    '**HPHC**\n- claim update',
    '**Optum**\n- reconciliation update',
    '**BBA**\n- payment update',
  ].join('\n\n');
  await h.handlers.get('llm_output')({ assistantTexts: [report] }, ctx);

  const changedRequest = 'Re-do the general report and add that I disabled AutoPay, portal payments, billing documents, and notifications.';
  const result = await promptTurn(h, changedRequest, [{ role: 'user', content: changedRequest }]);
  const injected = String(result?.appendSystemContext || '');
  assert.match(injected, /CORTEX_ACTIVE_REQUEST_LOCK/);
  assert.match(injected, /base_artifact_to_preserve_and_modify/);
  for (const section of ['BCBS', 'Medicare', 'HPHC', 'Optum', 'BBA']) assert.match(injected, new RegExp(section));
  assert.match(injected, /Treat “add\/update\/re-do\/revise” as additive/);
});

test('do-it continuation inherits prior repair intent and receives the coding task class', async () => {
  const h = harness();
  const result = await promptTurn(h, 'do it', [
    { role: 'user', content: 'Fully repair and harden the runtime regression.' },
    { role: 'assistant', content: 'I found the failure and prepared the repair.' },
    { role: 'user', content: 'do it' },
  ]);
  assert.match(String(result?.appendSystemContext || ''), /task_class: coding/);
});

test('tool calls remain uncapped per turn', async () => {
  const h = harness();
  const result = await promptTurn(h, 'Fix the plugin regression', [{ role: 'user', content: 'Fix the plugin regression' }]);
  assert.doesNotMatch(String(result?.appendSystemContext || ''), /max_tool_rounds|CORTEX_TOOL_BUDGET/);
  const before = h.handlers.get('before_tool_call');
  const after = h.handlers.get('after_tool_call');
  assert.equal(await before({ toolName: 'update_plan' }, ctx), undefined);
  for (let index = 0; index < 20; index += 1) await after({ toolName: 'exec', durationMs: 1 }, ctx);
  assert.equal(await before({ toolName: 'exec' }, ctx), undefined);
  assert.equal(await before({ toolName: 'exec' }, ctx), undefined);
});

test('tool persistence redacts secrets, bounds output, and collapses duplicate budget noise', () => {
  const h = harness();
  const persist = h.handlers.get('tool_result_persist');
  const secret = persist({ toolName: 'exec', message: { content: '{"writeToken":"super-secret-value-123456789"}' } }, ctx);
  assert.doesNotMatch(String(secret?.message?.content || ''), /super-secret-value/);
  assert.match(String(secret?.message?.content || ''), /REDACTED/);
  const long = persist({ toolName: 'exec', message: { content: 'x'.repeat(20_000) } }, ctx);
  assert.ok(String(long?.message?.content || '').length < 13_000);
  const duplicate = persist({ toolName: 'exec', message: { content: 'CORTEX_TOOL_BUDGET_ALREADY_EXHAUSTED duplicate_attempt=9' } }, ctx);
  assert.match(String(duplicate?.message?.content || ''), /duplicate blocked attempt omitted/);
});

test('noisy compaction sets a fail-closed warning on the next turn', async () => {
  const h = harness();
  const sessionFile = path.join(h.stateDir, 'noisy.jsonl');
  fs.writeFileSync(sessionFile, `${JSON.stringify({ type: 'compaction', summary: 'ry.json:277 ' + 'Tool Failures toolCall hard tool budget '.repeat(20) })}\n`);
  await h.handlers.get('after_compaction')({ sessionFile }, ctx);
  const result = await promptTurn(h, 'Continue the complete report', [{ role: 'user', content: 'Continue the complete report' }]);
  assert.match(String(result?.appendSystemContext || ''), /compaction_warning:/);
});
