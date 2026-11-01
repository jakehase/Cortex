import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import register from './index.ts';
import { cortexOpenClawCompatibilityMetadata } from './compat/openclaw-2026.7.ts';

const fixture = JSON.parse(fs.readFileSync(
  new URL('./nexus-orchestrate-response.fixture.json', import.meta.url),
  'utf8',
));
const metadata = cortexOpenClawCompatibilityMetadata();
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-openclaw-runtime-smoke-'));
const handlers = new Map();
const logLines = [];
let toolRegistered = false;
const sessionKey = 'agent:main:smoke:cortex-openclaw-runtime';
const context = {
  sessionKey,
  agentId: 'main',
  userId: 'smoke-user',
  channelId: 'smoke',
  accountId: 'default',
  messageId: 'smoke-message-1',
};
const sessionSecret = 'cortex-openclaw-runtime-smoke-session-secret';
const originalFetch = globalThis.fetch;

globalThis.fetch = async (url) => {
  const pathname = new URL(String(url)).pathname;
  if (pathname === '/knowledge/search') {
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (pathname === '/nexus/orchestrate') {
    return new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error(`unexpected smoke request: ${pathname}`);
};

try {
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

  const unsupported = await handlers.get('before_agent_finalize')(
    { messages: [{ role: 'assistant', content: 'I verified the production deployment is safe.' }] },
    context,
  );
  assert.equal(unsupported?.action, 'revise');

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

  const supported = await handlers.get('before_agent_finalize')(
    { messages: [{ role: 'assistant', content: 'Recommendation: proceed only with the observed focused-smoke evidence and retain rollback.' }] },
    context,
  );
  assert.equal(supported, undefined);

  await handlers.get('llm_output')(
    { assistantTexts: ['Recommendation: proceed only with the observed focused-smoke evidence and retain rollback.'] },
    context,
  );
  const delivery = await handlers.get('message_sending')(
    { to: 'smoke-destination', content: 'Recommendation: proceed only with the observed focused-smoke evidence and retain rollback.' },
    context,
  );
  assert.notEqual(delivery?.cancel, true);

  await handlers.get('agent_end')({ success: true }, context);
  const postEnd = await handlers.get('before_agent_finalize')(
    { messages: [{ role: 'assistant', content: 'I verified an unsupported claim.' }] },
    context,
  );
  assert.equal(postEnd, undefined);
  handlers.get('message_sent')({}, context);

  const receipt = {
    schemaVersion: 'cortex.openclaw.runtime-smoke.v1',
    status: 'passed',
    adapter: metadata,
    sourceCommit: '1de5218d2807f577b5dd1ec3a8d92985d084347b',
    registeredHooks: [...handlers.keys()],
    checks: {
      routeContextInjected: true,
      unsupportedClaimRevisionRequested: true,
      toolEvidenceObserved: true,
      toolPersistenceProjected: true,
      outputObserved: true,
      deliveryPreserved: true,
      agentEndClearedInflightState: true,
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
