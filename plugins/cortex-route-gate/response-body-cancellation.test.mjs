import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import register from './index.ts';

const SAFE_ROUTING_FAILURE = /routing unavailable while requireRouting is enabled; type=Error detail_hash=[0-9a-f]{64}/;

function setupRouteGate() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-cancel-'));
  const handlers = new Map();
  register({
    config: {
      enabled: true,
      requireRouting: true,
      sessionIdentityHmacSecret: 'session-identity-response-cancellation-test-secret',
      agentId: 'test-agent',
      userId: 'test-user',
      channelId: 'test-channel',
      writeToken: 'route-gate-production-write-token',
      scopeCredentialId: 'route-response-cancellation-test',
      scopeHmacSecret: 'route-response-cancellation-scope-secret',
      baseUrl: 'http://127.0.0.1:18888',
      maxResponseBytes: 1_024,
      stateDir,
    },
    logger: { info() {}, warn() {} },
    on(name, handler) { handlers.set(name, handler); },
  });
  return {
    handler: handlers.get('before_prompt_build'),
    cleanup() { fs.rmSync(stateDir, { recursive: true, force: true }); },
  };
}

function oversizedResponse(onCancel) {
  return new Response(new ReadableStream({ cancel: onCancel }), {
    status: 200,
    headers: { 'content-length': '1025', 'content-type': 'application/json' },
  });
}

test('concurrent Content-Length rejections cancel every routing response body', async () => {
  const { handler, cleanup } = setupRouteGate();
  const originalFetch = globalThis.fetch;
  let cancellations = 0;
  globalThis.fetch = async () => oversizedResponse(() => { cancellations += 1; });
  try {
    const attempts = Array.from({ length: 16 }, (_, index) => handler(
      { prompt: `Route request ${index}`, messages: [{ role: 'user', content: `Route request ${index}` }] },
      { sessionKey: `agent:main:test:${index}`, agentId: 'test-agent', userId: 'test-user', channelId: 'test-channel' },
    ));
    const results = await Promise.allSettled(attempts);
    assert.equal(cancellations, attempts.length);
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      assert.match(String(result.reason), SAFE_ROUTING_FAILURE);
      assert.doesNotMatch(String(result.reason), /response exceeds 1024 bytes/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test('a body cancellation failure does not mask the response size rejection', async () => {
  const { handler, cleanup } = setupRouteGate();
  const originalFetch = globalThis.fetch;
  let cancellationAttempted = false;
  globalThis.fetch = async () => oversizedResponse(() => {
    cancellationAttempted = true;
    throw new Error('transport cancellation failed');
  });
  try {
    await assert.rejects(
      () => handler(
        { prompt: 'Route request', messages: [{ role: 'user', content: 'Route request' }] },
        { sessionKey: 'agent:main:test:cancel-failure', agentId: 'test-agent', userId: 'test-user', channelId: 'test-channel' },
      ),
      SAFE_ROUTING_FAILURE,
    );
    assert.equal(cancellationAttempted, true);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test('a stalled body cancellation does not hold the size rejection open', async () => {
  const { handler, cleanup } = setupRouteGate();
  const originalFetch = globalThis.fetch;
  let cancellationAttempted = false;
  globalThis.fetch = async () => oversizedResponse(() => {
    cancellationAttempted = true;
    return new Promise(() => {});
  });
  try {
    await assert.rejects(
      handler(
        { prompt: 'Route request', messages: [{ role: 'user', content: 'Route request' }] },
        { sessionKey: 'agent:main:test:stalled-cancel', agentId: 'test-agent', userId: 'test-user', channelId: 'test-channel' },
      ),
      SAFE_ROUTING_FAILURE,
    );
    assert.equal(cancellationAttempted, true);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});
