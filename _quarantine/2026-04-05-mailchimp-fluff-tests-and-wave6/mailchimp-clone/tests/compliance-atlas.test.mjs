import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceAtlasSnapshot, createComplianceAtlasDashboardRoutes, createComplianceAtlasApiRoutes, createComplianceAtlasOpsRoutes, createComplianceAtlasPublicRoutes, createComplianceAtlasRegistryRoutes, summarizeComplianceAtlasFixtures } from '../packages/compliance-atlas/index.mjs';

test('compliance-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceAtlasDashboardRoutes().length, 3);
  assert.equal(createComplianceAtlasApiRoutes().length, 4);
  assert.equal(createComplianceAtlasOpsRoutes().length, 3);
  assert.equal(createComplianceAtlasPublicRoutes().length, 3);
  assert.equal(createComplianceAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceAtlasFixtures().contacts, 2);
});

