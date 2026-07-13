import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { requestText } from './cortex-browser-bridge/index.ts';

const execFileAsync = promisify(execFile);

async function withFetch(mock, operation) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('bridge request deadline aborts a fetch that never returns a response', async () => {
  await withFetch((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), async () => {
    await assert.rejects(
      requestText('http://cortex.invalid/hung', { method: 'GET' }, 20, 64),
      /abort/i,
    );
  });
});

test('bridge streaming read cancels an oversized response before consuming later chunks', async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(33));
    },
    cancel() { cancelled = true; },
  });
  await withFetch(async () => new Response(body, { status: 200 }), async () => {
    await assert.rejects(
      requestText('http://cortex.invalid/oversized', { method: 'GET' }, 1_000, 64),
      /response exceeds 64 bytes/,
    );
  });
  assert.equal(cancelled, true);
  assert.ok(pulls <= 3, `expected an early bounded-read cancellation, got ${pulls} pulls`);
});

const suites = [
  {
    name: 'memory retry, idempotency, lifecycle deduplication, and admission control',
    files: ['./cortex-memory-bridge/index.test.mjs'],
  },
  {
    name: 'strict routing and authenticated route-cache validation',
    files: [
      './cortex-route-gate/live-route-validation.test.mjs',
      './cortex-route-gate/route-cache-validation.test.mjs',
      './cortex-route-gate/creativity-governor.test.mjs',
    ],
  },
  {
    name: 'atomic state replacement, locking, concurrent writers, and process death',
    files: [
      './cortex-route-gate/lock-cleanup.test.mjs',
      './cortex-route-gate/route-state-concurrency.test.mjs',
    ],
  },
];

for (const { name, files } of suites) {
  test(name, async () => {
    const paths = files.map((file) => fileURLToPath(new URL(file, import.meta.url)));
    try {
      const { stderr } = await execFileAsync(process.execPath, ['--test', ...paths], {
        encoding: 'utf8',
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
        maxBuffer: 4 * 1024 * 1024,
        timeout: 60_000,
      });
      assert.equal(stderr, '');
    } catch (error) {
      const output = [error.stdout, error.stderr].filter(Boolean).join('\n');
      assert.fail(`${name} failed${output ? `:\n${output}` : `: ${error.message}`}`);
    }
  });
}
