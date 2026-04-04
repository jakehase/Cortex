import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPartnerSuccessSnapshot, createPartnerSuccessDashboardRoutes, createPartnerSuccessApiRoutes, createPartnerSuccessOpsRoutes, createPartnerSuccessPublicRoutes, summarizePartnerSuccessFixtures } from '../packages/partner-success/index.mjs';

test('partner-success package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildPartnerSuccessSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createPartnerSuccessDashboardRoutes().length, 3);
  assert.equal(createPartnerSuccessApiRoutes().length, 3);
  assert.equal(createPartnerSuccessOpsRoutes().length, 3);
  assert.equal(createPartnerSuccessPublicRoutes().length, 3);
  assert.equal(summarizePartnerSuccessFixtures().contacts, 2);
});
