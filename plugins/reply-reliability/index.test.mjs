import test from 'node:test';
import assert from 'node:assert/strict';

import register from './index.ts';

function createHarness(config = {}) {
  const handlers = new Map();
  const api = {
    pluginConfig: {
      channels: ['whatsapp'],
      maxAgeMs: 15 * 60 * 1000,
      summaryMaxChars: 120,
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
    messageReceived: handlers.get('message_received'),
    messageSending: handlers.get('message_sending'),
    messageSent: handlers.get('message_sent'),
  };
}

function ctx(overrides = {}) {
  return {
    channelId: 'whatsapp',
    accountId: 'default',
    conversationId: '+15551234567',
    ...overrides,
  };
}

test('replaces generic rate-limit reply with contextual fallback tied to latest user message', async () => {
  const h = createHarness();
  await h.messageReceived(
    {
      from: '+15551234567',
      content: 'Conversation info (untrusted metadata): ```json {"message_id":"1"} ```\nSender (untrusted metadata): ```json {"name":"Jake"} ```\nWhy were you just repeating messages?',
      timestamp: Date.now(),
    },
    ctx(),
  );

  const result = await h.messageSending(
    {
      to: '+15551234567',
      content: '⚠️ API rate limit reached. Please try again later.',
    },
    ctx(),
  );

  assert.ok(result?.content);
  assert.match(result.content, /rate limit/i);
  assert.match(result.content, /Why were you just repeating messages\?/);
  assert.doesNotMatch(result.content, /Conversation info/);
  assert.doesNotMatch(result.content, /Cortex upstream routing applied/);
});

test('leaves generic error untouched when there is no recent inbound context', async () => {
  const h = createHarness({ maxAgeMs: 10 });
  await h.messageReceived(
    {
      from: '+15551234567',
      content: 'who are you',
      timestamp: Date.now() - 60_000,
    },
    ctx(),
  );

  const result = await h.messageSending(
    {
      to: '+15551234567',
      content: '⚠️ API rate limit reached. Please try again later.',
    },
    ctx(),
  );

  assert.equal(result, undefined);
});

test('successful non-error delivery clears pending context', async () => {
  const h = createHarness();
  await h.messageReceived(
    {
      from: '+15551234567',
      content: 'who are you',
      timestamp: Date.now(),
    },
    ctx(),
  );

  await h.messageSent(
    {
      to: '+15551234567',
      content: 'I am Cortex.',
      success: true,
    },
    ctx(),
  );

  const result = await h.messageSending(
    {
      to: '+15551234567',
      content: 'The AI service returned an error. Please try again.',
    },
    ctx(),
  );

  assert.equal(result, undefined);
});
