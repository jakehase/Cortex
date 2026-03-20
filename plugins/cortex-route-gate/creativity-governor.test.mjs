import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import register from './index.ts';

const originalFetch = globalThis.fetch;

globalThis.fetch = async () => ({
  ok: true,
  text: async () => JSON.stringify({
    recommended_levels: [
      { level: 24, name: 'Nexus', reason: 'test routing' },
      { level: 5, name: 'Oracle', reason: 'test routing' },
    ],
    routing_method: 'semantic_orchestration',
    reasoning: ['test harness routing'],
  }),
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

function createHarness(config = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-creativity-governor-'));
  const handlers = new Map();
  const api = {
    config: {
      enabled: true,
      requireRouting: false,
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
  };
  register(api);
  return {
    stateDir,
    beforePromptBuild: handlers.get('before_prompt_build'),
  };
}

async function runBeforePromptBuild(harness, { prompt, messages, sessionKey }) {
  const handler = harness.beforePromptBuild;
  assert.equal(typeof handler, 'function', 'before_prompt_build hook should be registered');
  const result = await handler(
    { prompt, messages },
    { sessionKey }
  );
  assert.ok(result?.appendSystemContext, 'expected appendSystemContext from route gate');
  return String(result.appendSystemContext);
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
    sessionKey: 'agent:main:test:anchor-seed',
  });

  const context = await runBeforePromptBuild(harness, {
    prompt: 'Second prompt wrapper.',
    messages: [
      {
        role: 'user',
        content: 'Give me a from-scratch, orthogonal software idea that is not related to memory.',
      },
    ],
    sessionKey: 'agent:main:test:anchor-novelty',
  });

  assert.match(context, /CORTEX_CREATIVITY_GOVERNOR/);
  assert.match(context, /context_quarantine:/);
  assert.match(context, /- memory/);
  assert.match(context, /- graphs/);
  assert.match(context, /- trust/);
});
