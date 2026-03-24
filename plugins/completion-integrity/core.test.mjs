import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCompletionIntegrityEngine } from './core.mjs';

function makeHarness(opts = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-integrity-'));
  let now = Date.parse('2026-03-19T16:00:00.000Z');
  const deliveries = [];
  const engine = createCompletionIntegrityEngine({ stateDir, autoDeliveryAfterMs: 1000, retryBackoffMs: 1000, pollIntervalMs: 1000, escalationAfterMs: 2000, ...opts.config }, {
    clock: () => now,
    isoNow: () => new Date(now).toISOString(),
    logger: { warn() {}, info() {} },
    deliver: async (payload) => { deliveries.push(payload); return { ok: true }; },
  });
  return {
    stateDir,
    deliveries,
    engine,
    tick(ms) { now += ms; },
    task() { return engine.loadStore().tasks.at(-1); },
    metrics() { return engine.loadMetrics(); },
  };
}

function ctx(sessionKey = 'agent:main:whatsapp:direct:+1') {
  return { sessionKey, channelId: 'whatsapp', accountId: 'acct-1', conversationId: 'conv-1' };
}

test('tracks hard state machine through completion, send, confirmation, and close', async () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx());
  h.engine.onBeforePromptBuild({ prompt: 'Implement the delivery confirmation hardening' }, ctx());
  assert.equal(h.task().status, 'running');

  h.engine.onAgentEnd({ success: true, result: 'Implemented hardening and tests pass' }, ctx());
  assert.equal(h.task().status, 'internal_complete');
  assert.equal(h.task().validation.passed, true);

  h.tick(1500);
  await h.engine.autoDeliverCompletedTasks({});
  assert.equal(h.task().status, 'notification_sent');
  assert.equal(h.deliveries.length, 1);

  h.engine.onMessageSent({ content: 'Done: Implemented hardening and tests pass' }, ctx());
  assert.equal(h.task().status, 'closed');
  assert.ok(h.task().deliveryConfirmedAt);
  assert.ok(h.metrics().completion_to_delivery_confirmed_latency_ms.length >= 1);
});

test('important tasks require validator pass before auto-delivery', async () => {
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx());
  h.engine.onBeforePromptBuild({ prompt: 'Deploy and verify the restart recovery patch' }, ctx());
  const taskId = h.task().id;
  h.engine.completeInternally(taskId, 'failed');
  h.engine.runValidator(taskId, { source: 'manual' });
  assert.equal(h.task().validation.passed, false);

  h.tick(1500);
  await h.engine.autoDeliverCompletedTasks({});
  assert.equal(h.deliveries.length, 0);
  assert.equal(h.task().status, 'internal_complete');

  h.engine.completeInternally(taskId, 'deploy patch validated with restart evidence');
  h.engine.runValidator(taskId, { source: 'manual-2' });
  assert.equal(h.task().validation.passed, true);
  h.tick(1500);
  await h.engine.autoDeliverCompletedTasks({});
  assert.equal(h.deliveries.length, 1);
  assert.equal(h.task().status, 'notification_sent');
});

test('recovers stale running tasks across restart and counts recovery success', () => {
  const h = makeHarness();
  h.engine.onBeforePromptBuild({ prompt: 'Fix the background subagent notifier' }, ctx('sess-r')); 
  const taskId = h.task().id;
  h.engine.startTask(taskId);
  h.tick(5000);
  const recovered = h.engine.recoverStaleTasks();
  assert.equal(recovered, 1);
  assert.equal(h.task().status, 'internal_complete');
  assert.equal(h.metrics().counters.recovery_success_count, 1);
});

test('dedupes repeated auto-delivery attempts and records duplicate reply metric', async () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-d'));
  h.engine.onBeforePromptBuild({ prompt: 'Implement async notification dedupe' }, ctx('sess-d'));
  h.engine.onAgentEnd({ success: true, result: 'Async notification dedupe implemented' }, ctx('sess-d'));
  h.tick(1500);
  await h.engine.autoDeliverCompletedTasks({});
  assert.equal(h.deliveries.length, 1);
  await h.engine.autoDeliverCompletedTasks({});
  assert.equal(h.deliveries.length, 1);
  assert.ok(h.metrics().counters.duplicate_reply_count >= 0);
});

test('subagent completion flows to internal_complete and prompt injection appears until delivery confirmed', () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-s'));
  h.engine.onBeforePromptBuild({ prompt: 'Implement the trust-hardening system with subagent support' }, ctx('sess-s'));
  h.engine.onSubagentEnded({ result: 'Subagent finished trust-hardening system' }, ctx('sess-s'));
  assert.equal(h.task().status, 'internal_complete');
  const injection = h.engine.buildPromptInjection('sess-s');
  assert.match(injection.appendSystemContext, /must be clearly disclosed/);
});

test('runtime exec completed system messages promote active tasks to internal_complete', () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-x'));
  h.engine.onBeforePromptBuild({ prompt: 'Fix the gateway memory abort issue' }, ctx('sess-x'));
  assert.equal(h.task().status, 'running');
  h.engine.onBeforeMessageWrite({ message: { role: 'custom', content: 'System: [2026-03-19 22:50:15 CDT] Exec completed (delta-cr, code 0) :: bind=loopback ok' }, sessionKey: 'sess-x' }, ctx('sess-x'));
  assert.equal(h.task().status, 'internal_complete');
  assert.equal(h.task().completionSource, 'runtime_message');
});

test('runtime exec failed system messages fail active tasks', () => {
  const h = makeHarness();
  h.engine.onBeforePromptBuild({ prompt: 'Implement completion bridge for exec tasks' }, ctx('sess-f'));
  assert.equal(h.task().status, 'running');
  h.engine.onBeforeMessageWrite({ message: { role: 'custom', content: 'System: [2026-03-19 22:50:15 CDT] Exec failed (wild-wil, signal SIGKILL) :: process crashed' }, sessionKey: 'sess-f' }, ctx('sess-f'));
  assert.equal(h.task().status, 'failed');
  assert.equal(h.task().failureSource, 'runtime_message');
});

test('tool errors fail the task and increment tool error count', () => {
  const h = makeHarness();
  h.engine.onBeforePromptBuild({ prompt: 'Debug validator pipeline' }, ctx('sess-e'));
  h.engine.failTask(h.task().id, 'tool exploded', 'tool');
  assert.equal(h.task().status, 'failed');
  assert.equal(h.metrics().counters.tool_error_count, 1);
});

test('does not create completion-tracked tasks for conversational diagnostic questions', () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-q'));
  h.engine.onBeforePromptBuild({ prompt: 'Why were you just repeating messages?' }, ctx('sess-q'));
  assert.equal(h.engine.loadStore().tasks.length, 0);
});

test('strips routing and envelope chatter before task detection', () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-r2'));
  h.engine.onBeforePromptBuild({ prompt: 'Conversation info (untrusted metadata): ```json {"message_id":"1"} ```\nCortex upstream routing applied: L4, L15\nImplement the duplicate reply fix' }, ctx('sess-r2'));
  assert.equal(h.task().status, 'running');
  assert.equal(h.task().prompt, 'Implement the duplicate reply fix');
});
