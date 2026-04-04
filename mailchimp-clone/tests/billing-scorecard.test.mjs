import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingScorecardSnapshot, createBillingScorecardDashboardRoutes, createBillingScorecardApiRoutes, createBillingScorecardOpsRoutes, createBillingScorecardPublicRoutes, createBillingScorecardRegistryRoutes, summarizeBillingScorecardFixtures } from '../packages/billing-scorecard/index.mjs';

test('billing-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingScorecardDashboardRoutes().length, 3);
  assert.equal(createBillingScorecardApiRoutes().length, 4);
  assert.equal(createBillingScorecardOpsRoutes().length, 3);
  assert.equal(createBillingScorecardPublicRoutes().length, 3);
  assert.equal(createBillingScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingScorecardFixtures().contacts, 2);
});

