import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCustomerHealth, buildCustomerHealthSnapshot } from '../packages/customer-health/index.mjs';
import { summarizeEngagementForecasting, buildEngagementForecastingSnapshot } from '../packages/engagement-forecasting/index.mjs';
import { summarizeRetentionOffers, buildRetentionOffersSnapshot } from '../packages/retention-offers/index.mjs';
import { summarizeSegmentationQuality, buildSegmentationQualitySnapshot } from '../packages/segmentation-quality/index.mjs';
import { summarizeSenderRotation, buildSenderRotationSnapshot } from '../packages/sender-rotation/index.mjs';
import { summarizeSubscriptionIntelligence, buildSubscriptionIntelligenceSnapshot } from '../packages/subscription-intelligence/index.mjs';

test('wave6-cluster-lifecycle keeps the generated wave 6 modules executable and policy-complete', () => {
  assert.ok(summarizeCustomerHealth().metricCount >= 4);
  assert.equal(buildCustomerHealthSnapshot().validation.ok, true);
  assert.ok(summarizeEngagementForecasting().metricCount >= 4);
  assert.equal(buildEngagementForecastingSnapshot().validation.ok, true);
  assert.ok(summarizeRetentionOffers().metricCount >= 4);
  assert.equal(buildRetentionOffersSnapshot().validation.ok, true);
  assert.ok(summarizeSegmentationQuality().metricCount >= 4);
  assert.equal(buildSegmentationQualitySnapshot().validation.ok, true);
  assert.ok(summarizeSenderRotation().metricCount >= 4);
  assert.equal(buildSenderRotationSnapshot().validation.ok, true);
  assert.ok(summarizeSubscriptionIntelligence().metricCount >= 4);
  assert.equal(buildSubscriptionIntelligenceSnapshot().validation.ok, true);
});

