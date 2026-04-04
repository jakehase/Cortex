import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAttributionModeling, buildAttributionModelingSnapshot } from '../packages/attribution-modeling/index.mjs';
import { summarizeBenchmarkStudio, buildBenchmarkStudioSnapshot } from '../packages/benchmark-studio/index.mjs';
import { summarizeCampaignSandboxes, buildCampaignSandboxesSnapshot } from '../packages/campaign-sandboxes/index.mjs';
import { summarizeChannelPlaybooks, buildChannelPlaybooksSnapshot } from '../packages/channel-playbooks/index.mjs';
import { summarizeCreativeBriefBuilder, buildCreativeBriefBuilderSnapshot } from '../packages/creative-brief-builder/index.mjs';
import { summarizeCreativeQa, buildCreativeQaSnapshot } from '../packages/creative-qa/index.mjs';

test('wave6-cluster-growth keeps the generated wave 6 modules executable and policy-complete', () => {
  assert.ok(summarizeAttributionModeling().metricCount >= 4);
  assert.equal(buildAttributionModelingSnapshot().validation.ok, true);
  assert.ok(summarizeBenchmarkStudio().metricCount >= 4);
  assert.equal(buildBenchmarkStudioSnapshot().validation.ok, true);
  assert.ok(summarizeCampaignSandboxes().metricCount >= 4);
  assert.equal(buildCampaignSandboxesSnapshot().validation.ok, true);
  assert.ok(summarizeChannelPlaybooks().metricCount >= 4);
  assert.equal(buildChannelPlaybooksSnapshot().validation.ok, true);
  assert.ok(summarizeCreativeBriefBuilder().metricCount >= 4);
  assert.equal(buildCreativeBriefBuilderSnapshot().validation.ok, true);
  assert.ok(summarizeCreativeQa().metricCount >= 4);
  assert.equal(buildCreativeQaSnapshot().validation.ok, true);
});

