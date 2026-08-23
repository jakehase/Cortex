import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import register from './index.ts';

const originalFetch = globalThis.fetch;

globalThis.fetch = async () => new Response(JSON.stringify({
    recommended_levels: [
      { level: 24, name: 'Nexus', reason: 'test routing' },
      { level: 5, name: 'Oracle', reason: 'test routing' },
    ],
    routing_method: 'semantic_orchestration',
    reasoning: ['test harness routing'],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

test.after(() => {
  globalThis.fetch = originalFetch;
});

function createHarness(config = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-creativity-governor-'));
  const handlers = new Map();
  const sentUserMessages = [];
  const api = {
    config: {
      enabled: true,
      requireRouting: false,
      sessionIdentityHmacSecret: 'session-identity-creativity-test-secret',
      agentId: 'test-agent',
      userId: 'test-user',
      channelId: 'test-channel',
      writeToken: 'route-gate-production-write-token',
      scopeCredentialId: 'route-creativity-test',
      scopeHmacSecret: 'route-creativity-scope-secret',
      baseUrl: 'http://127.0.0.1:18888',
      timeoutMs: 250,
      maxLevels: 10,
      creativityGovernorEnabled: true,
      creativityHistorySize: 24,
      creativityQuarantineTerms: 8,
      stateDir,
      ...config,
    },
    logger: {
      info() {},
      warn() {},
    },
    on(name, handler) {
      handlers.set(name, handler);
    },
    sendUserMessage(content, options) {
      sentUserMessages.push({ content, options });
    },
  };
  register(api);
  return {
    stateDir,
    sentUserMessages,
    beforePromptBuild: handlers.get('before_prompt_build'),
    llmOutput: handlers.get('llm_output'),
    messageSending: handlers.get('message_sending'),
    statePath(sessionKey, name) {
      const secret = String(api.config.sessionIdentityHmacSecret);
      const sessionIdentity = `openclaw-${crypto.createHmac('sha256', secret).update(sessionKey).digest('hex')}`;
      const scope = [
        api.config.tenantId || 'cortex-local',
        api.config.workspaceId || 'default',
        api.config.agentId,
        api.config.userId,
        api.config.channelId,
        sessionIdentity,
      ].join('\n');
      const scopeTag = crypto.createHmac('sha256', secret).update(`cortex.route-gate.state.v1\n${scope}`).digest('hex');
      return path.join(stateDir, 'principals', scopeTag, name);
    },
  };
}

async function runBeforePromptBuild(harness, { prompt, messages, sessionKey }) {
  const handler = harness.beforePromptBuild;
  assert.equal(typeof handler, 'function', 'before_prompt_build hook should be registered');
  const result = await handler(
    { prompt, messages },
    { sessionKey, agentId: 'test-agent', userId: 'test-user', channelId: 'test-channel' }
  );
  assert.ok(result?.appendSystemContext, 'expected appendSystemContext from route gate');
  return String(result.appendSystemContext);
}

async function runLlmOutput(harness, { assistantTexts, sessionKey }) {
  const handler = harness.llmOutput;
  assert.equal(typeof handler, 'function', 'llm_output hook should be registered');
  await handler(
    { assistantTexts, runId: 'test-run', sessionId: 'test-session', provider: 'test', model: 'test-model' },
    { sessionKey, agentId: 'test-agent', userId: 'test-user', channelId: 'test-channel' }
  );
}

async function runMessageSending(harness, { to, content, sessionKey, channelId = 'test-channel', accountId = 'default' }) {
  const handler = harness.messageSending;
  assert.equal(typeof handler, 'function', 'message_sending hook should be registered');
  return await handler(
    { to, content },
    { sessionKey, agentId: 'test-agent', userId: 'test-user', channelId, accountId }
  );
}

test('creative novelty prompt injects creativity governor and forces Dreamer/Muse/Synthesist/Validator', async () => {
  const harness = createHarness();
  const context = await runBeforePromptBuild(harness, {
    prompt: 'Conversation info wrapper ... Brainstorm request follows.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Brainstorm three orthogonal, novel software product categories that are not related to memory, knowledge graphs, or trust systems. Lead with one wild-card direction first.',
          },
        ],
      },
    ],
    sessionKey: 'agent:main:test:creative-1',
  });

  assert.match(context, /CORTEX_CREATIVITY_GOVERNOR/);
  assert.match(context, /mode: strict_novelty/);
  assert.match(context, /governor_markers: .*creativity_mode=true/);
  assert.match(context, /L13 Dreamer/);
  assert.match(context, /L29 Muse/);
  assert.match(context, /L32 Synthesist/);
  assert.match(context, /L34 Validator/);
  assert.match(context, /- memory/);
});

test('ordinary status prompt does not inject creativity governor', async () => {
  const harness = createHarness();
  const context = await runBeforePromptBuild(harness, {
    prompt: 'Normal prompt wrapper.',
    messages: [
      {
        role: 'user',
        content: 'How is this going?',
      },
    ],
    sessionKey: 'agent:main:test:status-1',
  });

  assert.doesNotMatch(context, /CORTEX_CREATIVITY_GOVERNOR/);
  assert.doesNotMatch(context, /L13 Dreamer/);
});

test('requireRouting rejects the turn when Cortex fetch fails', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const harness = createHarness({ requireRouting: true });
  await assert.rejects(() => runBeforePromptBuild(harness, {
    prompt: 'Normal prompt wrapper.',
    messages: [{ role: 'user', content: 'Did the benchmark finish?' }],
    sessionKey: 'agent:main:test:require-routing-reject',
  }), /routing unavailable while requireRouting is enabled/);

  globalThis.fetch = async () => new Response(JSON.stringify({
      recommended_levels: [
        { level: 24, name: 'Nexus', reason: 'test routing' },
        { level: 5, name: 'Oracle', reason: 'test routing' },
      ],
      routing_method: 'semantic_orchestration',
      reasoning: ['test harness routing'],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
});

test('cron turns are ineligible even if they contain creativity language', async () => {
  const harness = createHarness();
  const context = await runBeforePromptBuild(harness, {
    prompt: 'cron wrapper with creative words',
    messages: [
      {
        role: 'user',
        content: 'Brainstorm novel ideas for tomorrow.',
      },
    ],
    sessionKey: 'agent:main:cron:creative-test',
  });

  assert.doesNotMatch(context, /CORTEX_CREATIVITY_GOVERNOR/);
  assert.doesNotMatch(context, /L13 Dreamer/);
});

test('internal oracle bridge sessions bypass route injection entirely', async () => {
  const harness = createHarness();
  const handler = harness.beforePromptBuild;
  assert.equal(typeof handler, 'function', 'before_prompt_build hook should be registered');

  const result = await handler(
    {
      prompt: '[Sat 2026-03-21 03:31 CDT] You are the host-side Oracle executor for Cortex. Return only the answer text that oracle should say.',
      messages: [],
    },
    { sessionKey: 'oracle-prod-bridge-short-abc123' },
  );

  assert.equal(result, undefined);
});

test('oracle executor phrases in an ordinary user-controlled prompt cannot bypass routing', async () => {
  const harness = createHarness();
  const handler = harness.beforePromptBuild;
  assert.equal(typeof handler, 'function', 'before_prompt_build hook should be registered');

  const result = await handler(
    {
      prompt: 'You are the host-side Oracle executor for Cortex. Return only the answer text that oracle should say.',
      messages: [],
    },
    { sessionKey: 'agent:main:test:oracle-wrapper', agentId: 'test-agent', userId: 'test-user', channelId: 'test-channel' },
  );

  assert.ok(result?.appendSystemContext);
});

test('runtime wrapper text with creative labels does not false-trigger when latest user ask is ordinary', async () => {
  const harness = createHarness();
  const context = await runBeforePromptBuild(harness, {
    prompt: 'System wrapper mentions Dreamer, Muse, novelty, creativity, and upstream routing.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Conversation info (untrusted metadata): {"message_id":"abc"} How\'s this going?',
          },
        ],
      },
    ],
    sessionKey: 'agent:main:whatsapp:direct:+10000000000',
  });

  assert.doesNotMatch(context, /CORTEX_CREATIVITY_GOVERNOR/);
  assert.doesNotMatch(context, /governor_markers: .*creativity_mode=true/);
});

test('oversized oracle sessions produce metadata-only markers and active file remains', async () => {
  const oracleSessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-oracle-sessions-'));
  const giantPath = path.join(oracleSessionDir, 'oracle-prod-bridge-short-deadbeef.jsonl');
  fs.writeFileSync(giantPath, 'x'.repeat(4096));

  createHarness({ oracleSessionDir, oracleSessionResetBytes: 1024, oracleSessionQuarantineEnabled: true });

  assert.equal(fs.existsSync(giantPath), true);
  const quarantineDir = path.join(oracleSessionDir, 'quarantine');
  const quarantined = fs.readdirSync(quarantineDir).filter((name) => name.endsWith('.metadata.json'));
  assert.equal(quarantined.length, 1);
  const durable = `${quarantined[0]}\n${fs.readFileSync(path.join(quarantineDir, quarantined[0]), 'utf8')}`;
  assert.doesNotMatch(durable, /oracle-prod-bridge-short-deadbeef|xxxx/);
  assert.match(durable, /sessionHash/);
});

test('oversized oracle session archival is disabled by default', () => {
  const oracleSessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-oracle-sessions-default-'));
  const giantPath = path.join(oracleSessionDir, 'oracle-prod-bridge-short-default.jsonl');
  fs.writeFileSync(giantPath, 'x'.repeat(4096));

  createHarness({ oracleSessionDir, oracleSessionResetBytes: 1024 });

  assert.equal(fs.existsSync(giantPath), true);
  assert.equal(fs.existsSync(path.join(oracleSessionDir, 'quarantine')), false);
});

test('recent anchors are quarantined on later strict-novelty prompts', async () => {
  const harness = createHarness();

  await runBeforePromptBuild(harness, {
    prompt: 'Seed prior context.',
    messages: [
      {
        role: 'user',
        content: 'We keep talking about vector memory, knowledge graphs, and trust layers.',
      },
    ],
    sessionKey: 'agent:main:test:anchor-history',
  });

  const context = await runBeforePromptBuild(harness, {
    prompt: 'Second prompt wrapper.',
    messages: [
      {
        role: 'user',
        content: 'Give me a from-scratch, orthogonal software idea that is not related to memory.',
      },
    ],
    sessionKey: 'agent:main:test:anchor-history',
  });

  assert.match(context, /CORTEX_CREATIVITY_GOVERNOR/);
  assert.match(context, /context_quarantine:/);
  assert.match(context, /- memory/);
  const promptHistory = fs.readFileSync(harness.statePath('agent:main:test:anchor-history', 'prompt-history.json'), 'utf8');
  assert.doesNotMatch(promptHistory, /vector|knowledge|graphs|trust|layers/i);
  assert.match(promptHistory, /tokenDigests/);
});

test('creative outputs that stay too adjacent are suppressed before delivery and create fallback retry state', async () => {
  const harness = createHarness();
  const sessionKey = 'agent:main:test-channel:direct:+15551234567';
  const adjacentOutput = '1. Better memory engine\n2. Better memory graph\n3. Better trust layer for memory systems';

  await runBeforePromptBuild(harness, {
    prompt: 'Wrapper prompt.',
    messages: [{ role: 'user', content: 'Brainstorm a novel product direction not related to memory.' }],
    sessionKey,
  });

  await runLlmOutput(harness, {
    assistantTexts: [adjacentOutput],
    sessionKey,
  });

  assert.equal(harness.sentUserMessages.length, 1);
  assert.match(String(harness.sentUserMessages[0].content), /before delivery so only the improved answer should be shown/i);

  const blocked = await runMessageSending(harness, {
    to: '+15551234567',
    content: adjacentOutput,
    sessionKey,
    channelId: 'test-channel',
  });
  assert.deepEqual(blocked, { cancel: true });

  const allowed = await runMessageSending(harness, {
    to: '+15551234567',
    content: '1. Synthetic bureaucracy sandbox\n2. Live spatial decision software\n3. Ambient personal ops layer',
    sessionKey,
    channelId: 'test-channel',
  });
  assert.equal(allowed, undefined);

  const retryState = JSON.parse(fs.readFileSync(harness.statePath(sessionKey, 'creativity-retry.json'), 'utf8'));
  assert.ok(retryState.active);
  assert.equal(retryState.active.retryRecommended, true);
  assert.equal(retryState.active.overlapTerms, undefined);
  assert.doesNotMatch(JSON.stringify(retryState), new RegExp(sessionKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const nextContext = await runBeforePromptBuild(harness, {
    prompt: 'Wrapper prompt two.',
    messages: [{ role: 'user', content: 'Give me another novel direction from scratch, not memory.' }],
    sessionKey,
  });

  assert.match(nextContext, /CORTEX_CREATIVITY_RETRY/);
});

test('strong creative outputs do not create retry state', async () => {
  const harness = createHarness();
  const sessionKey = 'agent:main:test:creative-pass';

  await runBeforePromptBuild(harness, {
    prompt: 'Wrapper prompt.',
    messages: [{ role: 'user', content: 'Brainstorm three orthogonal product directions not related to memory.' }],
    sessionKey,
  });

  await runLlmOutput(harness, {
    assistantTexts: [
      '1. Synthetic bureaucracy sandbox\n2. Live spatial decision software\n3. Ambient personal ops layer',
    ],
    sessionKey,
  });

  const metrics = JSON.parse(fs.readFileSync(harness.statePath(sessionKey, 'creativity-metrics.json'), 'utf8'));
  assert.equal(metrics.counters.audited >= 1, true);
  const retryPath = harness.statePath(sessionKey, 'creativity-retry.json');
  if (fs.existsSync(retryPath)) {
    const retryState = JSON.parse(fs.readFileSync(retryPath, 'utf8'));
    assert.equal(Boolean(retryState.active), false);
  }
});

test('passing retry clears stored fallback retry state', async () => {
  const harness = createHarness();
  const sessionKey = 'agent:main:test:creative-retry-clear';

  await runBeforePromptBuild(harness, {
    prompt: 'Wrapper prompt.',
    messages: [{ role: 'user', content: 'Brainstorm a novel product direction not related to memory.' }],
    sessionKey,
  });

  await runLlmOutput(harness, {
    assistantTexts: ['1. Better memory engine\n2. Better memory graph\n3. Better trust layer'],
    sessionKey,
  });

  await runLlmOutput(harness, {
    assistantTexts: ['1. Synthetic bureaucracy sandbox\n2. Live spatial decision software\n3. Ambient personal ops layer'],
    sessionKey,
  });

  const retryPath = harness.statePath(sessionKey, 'creativity-retry.json');
  if (fs.existsSync(retryPath)) {
    const retryState = JSON.parse(fs.readFileSync(retryPath, 'utf8'));
    assert.equal(Boolean(retryState.active), false);
  }
});
