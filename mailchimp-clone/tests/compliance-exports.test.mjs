import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceExportsSnapshot, createComplianceExportsDashboardRoutes, createComplianceExportsApiRoutes, createComplianceExportsOpsRoutes, createComplianceExportsPublicRoutes, summarizeComplianceExportsFixtures } from '../packages/compliance-exports/index.mjs';

test('compliance-exports package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildComplianceExportsSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceExportsDashboardRoutes().length, 3);
  assert.equal(createComplianceExportsApiRoutes().length, 3);
  assert.equal(createComplianceExportsOpsRoutes().length, 3);
  assert.equal(createComplianceExportsPublicRoutes().length, 3);
  assert.equal(summarizeComplianceExportsFixtures().contacts, 2);
});
