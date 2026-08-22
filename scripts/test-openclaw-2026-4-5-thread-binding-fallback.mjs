#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const bundlePath = '/root/clawd/_staging/openclaw-2026.4.5/dist/pi-embedded-DWASRjxE.js';
const source = fs.readFileSync(bundlePath, 'utf8');
const start = source.indexOf('function summarizeError$1(err) {');
const end = source.indexOf('async function spawnSubagentDirect(params, ctx) {');
if (start === -1 || end === -1 || end <= start) {
  throw new Error('Could not locate patched thread-binding helper block in staged bundle');
}
const snippet = source.slice(start, end);

function makeBindingService(overrides = {}) {
  const calls = [];
  const service = {
    calls,
    getCapabilities() {
      return overrides.capabilities || { adapterAvailable: true, bindSupported: true, placements: ['current', 'child'] };
    },
    resolveByConversation(ref) {
      calls.push({ type: 'resolveByConversation', ref });
      return overrides.existingBinding || null;
    },
    async bind(payload) {
      calls.push({ type: 'bind', payload });
      if (overrides.bindError) throw overrides.bindError;
      return { ok: true };
    },
  };
  return service;
}

function buildHarness(options = {}) {
  const bindingService = options.bindingService || makeBindingService(options);
  const factory = new Function('deps', `
    const {
      resolveConversationIdForThreadBinding,
      resolveThreadBindingSpawnPolicy,
      formatThreadBindingDisabledError,
      formatThreadBindingSpawnDisabledError,
      getSessionBindingService,
      resolveThreadBindingThreadName,
      resolveThreadBindingIntroText,
      resolveThreadBindingIdleTimeoutMsForChannel,
      resolveThreadBindingMaxAgeMsForChannel
    } = deps;
    ${snippet}
    return {
      summarizeError$1,
      resolveSubagentSpawnConversationId,
      ensureCurrentConversationBindingForSubagentSpawn,
      ensureThreadBindingForSubagentSpawn
    };
  `);
  const api = factory({
    resolveConversationIdForThreadBinding: options.resolveConversationIdForThreadBinding || ((params) => `${params.channel}:${params.to}`),
    resolveThreadBindingSpawnPolicy: options.resolveThreadBindingSpawnPolicy || ((params) => ({ enabled: true, spawnEnabled: true, channel: params.channel, accountId: params.accountId })),
    formatThreadBindingDisabledError: options.formatThreadBindingDisabledError || ((params) => `disabled:${params.channel}:${params.accountId}:${params.kind}`),
    formatThreadBindingSpawnDisabledError: options.formatThreadBindingSpawnDisabledError || ((params) => `spawn-disabled:${params.channel}:${params.accountId}:${params.kind}`),
    getSessionBindingService: () => bindingService,
    resolveThreadBindingThreadName: options.resolveThreadBindingThreadName || ((params) => params.label || params.agentId || 'subagent'),
    resolveThreadBindingIntroText: options.resolveThreadBindingIntroText || ((params) => `intro:${params.agentId}:${params.label || ''}:${params.idleTimeoutMs}:${params.maxAgeMs}`),
    resolveThreadBindingIdleTimeoutMsForChannel: options.resolveThreadBindingIdleTimeoutMsForChannel || (() => 600000),
    resolveThreadBindingMaxAgeMsForChannel: options.resolveThreadBindingMaxAgeMsForChannel || (() => 86400000),
  });
  return { ...api, bindingService };
}

async function testFallbackBindsCurrentConversation() {
  const harness = buildHarness();
  const result = await harness.ensureThreadBindingForSubagentSpawn({
    cfg: { plugins: {}, gateway: {} },
    hookRunner: { hasHooks: () => false },
    childSessionKey: 'child-1',
    agentId: 'oracle',
    label: 'Thread Helper',
    mode: 'session',
    requesterSessionKey: 'parent-1',
    requester: {
      channel: 'whatsapp',
      accountId: 'default',
      to: '+17855410986',
      threadId: 'wa-thread-123',
    },
  });

  assert.deepEqual(result, { status: 'ok' });
  const bindCall = harness.bindingService.calls.find((entry) => entry.type === 'bind');
  assert.ok(bindCall, 'expected fallback bind call');
  assert.equal(bindCall.payload.placement, 'current');
  assert.equal(bindCall.payload.targetKind, 'subagent');
  assert.equal(bindCall.payload.conversation.channel, 'whatsapp');
  assert.equal(bindCall.payload.conversation.conversationId, 'wa-thread-123');
}

async function testHookSuccessShortCircuitsFallback() {
  const harness = buildHarness();
  let runCalls = 0;
  const result = await harness.ensureThreadBindingForSubagentSpawn({
    cfg: {},
    hookRunner: {
      hasHooks: (name) => name === 'subagent_spawning',
      runSubagentSpawning: async () => {
        runCalls += 1;
        return { status: 'ok', threadBindingReady: true };
      },
    },
    childSessionKey: 'child-2',
    agentId: 'oracle',
    label: 'Hook First',
    mode: 'session',
    requesterSessionKey: 'parent-2',
    requester: { channel: 'whatsapp', accountId: 'default', to: '+17855410986', threadId: 'wa-thread-456' },
  });

  assert.deepEqual(result, { status: 'ok' });
  assert.equal(runCalls, 1);
  assert.equal(harness.bindingService.calls.filter((entry) => entry.type === 'bind').length, 0);
}

async function testExistingBindingConflictErrors() {
  const harness = buildHarness({ existingBinding: { targetSessionKey: 'someone-else', status: 'active' } });
  const result = await harness.ensureThreadBindingForSubagentSpawn({
    cfg: {},
    hookRunner: { hasHooks: () => false },
    childSessionKey: 'child-3',
    agentId: 'oracle',
    label: 'Conflict',
    mode: 'session',
    requesterSessionKey: 'parent-3',
    requester: { channel: 'whatsapp', accountId: 'default', to: '+17855410986', threadId: 'wa-thread-789' },
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /already bound to another session/i);
}

async function main() {
  await testFallbackBindsCurrentConversation();
  await testHookSuccessShortCircuitsFallback();
  await testExistingBindingConflictErrors();
  console.log(JSON.stringify({
    bundlePath,
    tests: [
      'fallback_binds_current_conversation',
      'hook_success_short_circuits_fallback',
      'existing_binding_conflict_errors'
    ],
    status: 'ok'
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
