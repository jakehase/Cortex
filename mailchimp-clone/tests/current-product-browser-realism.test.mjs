import test from 'node:test';
import assert from 'node:assert/strict';
import { runCurrentProductBrowserProof } from '../scripts/lib/current-product-browser-proof.mjs';

test('Current-product browser realism: websites, AI, omnichannel, content depth, and integration detail render as real browser journeys', async () => {
  const result = await runCurrentProductBrowserProof({ captureScreenshots: false, headless: true });
  assert.equal(result.ok, true);
  assert.equal(result.realBrowser, true);
  assert.ok(result.browserChecks >= 9, `Expected at least 9 browser checks, got ${result.browserChecks}`);
  assert.ok(result.realBrowserChecks >= 9, `Expected at least 9 real-browser checks, got ${result.realBrowserChecks}`);
  assert.ok(result.browserJourneyFamilies >= 5, `Expected at least 5 covered journey families, got ${result.browserJourneyFamilies}`);
  assert.match(result.coveredFamilies.join(','), /campaign_ai_experiments/);
  assert.match(result.coveredFamilies.join(','), /website_builder/);
  assert.match(result.coveredFamilies.join(','), /automation_omnichannel/);
  assert.match(result.coveredFamilies.join(','), /content_depth/);
  assert.match(result.coveredFamilies.join(','), /integration_detail/);
});
