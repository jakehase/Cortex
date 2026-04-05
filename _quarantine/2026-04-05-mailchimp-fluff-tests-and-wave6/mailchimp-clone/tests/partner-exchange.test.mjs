import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartnerExchangeWorkspace, summarizePartnerExchange, validatePartnerExchangePlan, createPartnerExchangeDashboardRoutes, createPartnerExchangeApiRoutes } from '../packages/partner-exchange/index.mjs';

test('partner-exchange exposes a real package surface with route manifests and validation', () => {
  const workspace = createPartnerExchangeWorkspace('Anchor Demo');
  const summary = summarizePartnerExchange(workspace);
  const validation = validatePartnerExchangePlan({ owner: 'owner-1', milestones: ['plan', 'ship'], channels: ['email', 'app'] });
  const dashboardRoutes = createPartnerExchangeDashboardRoutes();
  const apiRoutes = createPartnerExchangeApiRoutes();

  assert.equal(summary.workspaceName, 'Anchor Demo');
  assert.equal(summary.metricCount, 3);
  assert.equal(validation.ok, true);
  assert.equal(dashboardRoutes.length, 3);
  assert.equal(apiRoutes.length, 2);
});
