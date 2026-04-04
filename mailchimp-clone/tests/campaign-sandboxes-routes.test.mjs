import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignSandboxesDashboardRoutes, createCampaignSandboxesApiRoutes, createCampaignSandboxesOpsRoutes, createCampaignSandboxesPublicRoutes } from '../packages/campaign-sandboxes/index.mjs';

test('campaign-sandboxes routes honor custom base paths and stable ids', () => {
  const dashboard = createCampaignSandboxesDashboardRoutes('/labs/campaign-sandboxes');
  const api = createCampaignSandboxesApiRoutes('/api/labs/campaign-sandboxes');
  const ops = createCampaignSandboxesOpsRoutes('/ops/labs/campaign-sandboxes');
  const pub = createCampaignSandboxesPublicRoutes('/public/labs/campaign-sandboxes');
  assert.equal(dashboard[0].path, '/labs/campaign-sandboxes');
  assert.equal(api[0].path, '/api/labs/campaign-sandboxes/overview');
  assert.equal(ops[0].path, '/ops/labs/campaign-sandboxes/health');
  assert.equal(pub[0].path, '/public/labs/campaign-sandboxes');
  assert.match(dashboard[0].id, /campaign\-sandboxes/);
  assert.match(api[2].id, /campaign\-sandboxes/);
});

