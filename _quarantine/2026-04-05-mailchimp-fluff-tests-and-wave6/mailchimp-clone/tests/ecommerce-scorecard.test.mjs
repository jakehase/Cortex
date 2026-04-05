import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceScorecardSnapshot, createEcommerceScorecardDashboardRoutes, createEcommerceScorecardApiRoutes, createEcommerceScorecardOpsRoutes, createEcommerceScorecardPublicRoutes, createEcommerceScorecardRegistryRoutes, summarizeEcommerceScorecardFixtures } from '../packages/ecommerce-scorecard/index.mjs';

test('ecommerce-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceScorecardDashboardRoutes().length, 3);
  assert.equal(createEcommerceScorecardApiRoutes().length, 4);
  assert.equal(createEcommerceScorecardOpsRoutes().length, 3);
  assert.equal(createEcommerceScorecardPublicRoutes().length, 3);
  assert.equal(createEcommerceScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceScorecardFixtures().contacts, 2);
});

