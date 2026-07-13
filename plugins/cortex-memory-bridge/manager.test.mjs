import test from 'node:test';
import assert from 'node:assert/strict';

import { CortexMemorySearchManager } from './manager.mjs';

test('manager search attaches configured Cortex write authorization', async () => {
  const originalFetch = globalThis.fetch;
  let headers;
  globalThis.fetch = async (_url, options) => {
    headers = new Headers(options?.headers);
    return new Response('{"results":[]}');
  };
  try {
    const manager = await CortexMemorySearchManager.create({
      cfg: { retryCount: 0, writeToken: 'manager-secret', writeTokenHeader: 'x-manager-token' },
      agentId: 'authorization-test',
    });
    await manager.search('authorized search');
    assert.equal(headers.get('x-manager-token'), 'manager-secret');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent declared-size rejections do not await body cancellation', async () => {
  const originalFetch = globalThis.fetch;
  const releases = [];
  let cancellations = 0;
  globalThis.fetch = async () => ({
    ok: true,
    headers: new Headers({ 'content-length': '65' }),
    body: {
      async cancel() {
        cancellations += 1;
        await new Promise((resolve) => { releases.push(resolve); });
      },
      getReader() { throw new Error('oversized response body must not be read'); },
    },
  });

  try {
    const manager = await CortexMemorySearchManager.create({
      cfg: { maxResponseBytes: 64, retryCount: 0 },
      agentId: 'size-limit-test',
    });
    const searches = Array.from({ length: 8 }, (_, index) => manager.search(`oversized-${index}`));
    const results = Promise.allSettled(searches);
    let settled = false;
    results.then(() => { settled = true; });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancellations, searches.length, 'each response body is canceled');
    assert.equal(settled, true, 'search rejection is independent of stalled body cancellation');

    const outcomes = await results;
    for (const outcome of outcomes) {
      assert.equal(outcome.status, 'rejected');
      assert.match(outcome.reason.message, /response exceeds 64 bytes/);
    }
  } finally {
    for (const release of releases) release();
    globalThis.fetch = originalFetch;
  }
});
