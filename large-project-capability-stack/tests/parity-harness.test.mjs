import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  createFixtureTarget,
  createHttpTarget,
  createBrowserAdapterTarget,
  createSimulatedBrowserDriver,
  runParityHarness
} from '../packages/parity-harness/index.mjs';

test('runs fixture and http parity checks', async () => {
  const fixtureReport = await runParityHarness({
    target: createFixtureTarget({ '/hello': 'hello world', '/json': { ok: true } }),
    checks: [
      { id: 'fixture.text', type: 'text', path: '/hello', expect: 'hello' },
      { id: 'fixture.json', type: 'json', path: '/json', select: (payload) => payload.ok, expect: true }
    ]
  });
  assert.equal(fixtureReport.ok, true);
  assert.equal(fixtureReport.evidence.mode, 'fixture');
  assert.ok(fixtureReport.evidence.mechanicalDowngrades.includes('fixture_only_evidence'));

  const server = http.createServer((req, res) => {
    if (req.url === '/status') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.end('route ok');
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    const report = await runParityHarness({
      target: createHttpTarget({ baseUrl: `http://127.0.0.1:${port}` }),
      checks: [
        { id: 'http.text', type: 'text', path: '/', expect: 'route ok' },
        { id: 'http.json', type: 'json', path: '/status', select: (payload) => payload.ok, expect: true }
      ]
    });
    assert.equal(report.ok, true);
    assert.equal(report.evidence.mode, 'http');
    assert.ok(report.evidence.mechanicalDowngrades.includes('http_only_evidence'));
  } finally {
    server.close();
  }
});

test('tracks simulated browser adapter evidence separately from real browser proof', async () => {
  const target = createBrowserAdapterTarget({
    browserName: 'simulated-driver',
    realBrowser: false,
    driver: createSimulatedBrowserDriver({
      '/app': '<html><body>Dashboard</body></html>',
      '/status': { ok: true }
    })
  });

  const report = await runParityHarness({
    target,
    checks: [
      { id: 'browser.text', type: 'browser_text', path: '/app', expect: 'Dashboard' },
      { id: 'browser.json', type: 'json', path: '/status', select: (payload) => payload.ok, expect: true }
    ]
  });

  assert.equal(report.ok, true);
  assert.equal(report.evidence.browser.available, true);
  assert.equal(report.evidence.browser.real, false);
  assert.ok(report.evidence.mechanicalDowngrades.includes('no_real_browser_proof'));
});
