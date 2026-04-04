import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrandGovernanceSnapshot, createBrandGovernanceDashboardRoutes, createBrandGovernanceApiRoutes, createBrandGovernanceOpsRoutes, createBrandGovernancePublicRoutes, summarizeBrandGovernanceFixtures } from '../packages/brand-governance/index.mjs';

test('brand-governance package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildBrandGovernanceSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBrandGovernanceDashboardRoutes().length, 3);
  assert.equal(createBrandGovernanceApiRoutes().length, 3);
  assert.equal(createBrandGovernanceOpsRoutes().length, 3);
  assert.equal(createBrandGovernancePublicRoutes().length, 3);
  assert.equal(summarizeBrandGovernanceFixtures().contacts, 2);
});
