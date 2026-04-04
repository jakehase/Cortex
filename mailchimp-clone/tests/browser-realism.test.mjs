import test from 'node:test';
import assert from 'node:assert/strict';
import { runWave1BrowserProof } from '../scripts/lib/wave1-browser-proof.mjs';

test('Wave 1 browser realism foundation: real browser proof spans major journey families', async () => {
  const result = await runWave1BrowserProof({ captureScreenshots: false, headless: true });
  assert.equal(result.ok, true);
  assert.equal(result.realBrowser, true);
  assert.ok(result.browserChecks >= 60, `Expected at least 60 browser checks, got ${result.browserChecks}`);
  assert.ok(result.realBrowserChecks >= 60, `Expected at least 60 real-browser checks, got ${result.realBrowserChecks}`);
  assert.ok(result.browserJourneyFamilies >= 8, `Expected at least 8 covered journey families, got ${result.browserJourneyFamilies}`);
  assert.match(result.coveredFamilies.join(','), /campaign_editor/);
  assert.match(result.coveredFamilies.join(','), /public_signup_flows/);
  assert.match(result.coveredFamilies.join(','), /reports_analytics/);
});
