import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDataActivation, buildDataActivationSnapshot } from '../packages/data-activation/index.mjs';
import { summarizeEcommerceInsights, buildEcommerceInsightsSnapshot } from '../packages/ecommerce-insights/index.mjs';
import { summarizeMultiAccountControl, buildMultiAccountControlSnapshot } from '../packages/multi-account-control/index.mjs';
import { summarizePredictiveSegments, buildPredictiveSegmentsSnapshot } from '../packages/predictive-segments/index.mjs';
import { summarizeProfileEnrichment, buildProfileEnrichmentSnapshot } from '../packages/profile-enrichment/index.mjs';
import { summarizeRevenueAttribution, buildRevenueAttributionSnapshot } from '../packages/revenue-attribution/index.mjs';

test('wave6-cluster-data keeps the generated wave 6 modules executable and policy-complete', () => {
  assert.ok(summarizeDataActivation().metricCount >= 4);
  assert.equal(buildDataActivationSnapshot().validation.ok, true);
  assert.ok(summarizeEcommerceInsights().metricCount >= 4);
  assert.equal(buildEcommerceInsightsSnapshot().validation.ok, true);
  assert.ok(summarizeMultiAccountControl().metricCount >= 4);
  assert.equal(buildMultiAccountControlSnapshot().validation.ok, true);
  assert.ok(summarizePredictiveSegments().metricCount >= 4);
  assert.equal(buildPredictiveSegmentsSnapshot().validation.ok, true);
  assert.ok(summarizeProfileEnrichment().metricCount >= 4);
  assert.equal(buildProfileEnrichmentSnapshot().validation.ok, true);
  assert.ok(summarizeRevenueAttribution().metricCount >= 4);
  assert.equal(buildRevenueAttributionSnapshot().validation.ok, true);
});

