import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceCockpitSnapshot, createComplianceCockpitDashboardRoutes, createComplianceCockpitApiRoutes, createComplianceCockpitOpsRoutes, createComplianceCockpitPublicRoutes, createComplianceCockpitRegistryRoutes, summarizeComplianceCockpitFixtures } from '../packages/compliance-cockpit/index.mjs';

test('compliance-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceCockpitDashboardRoutes().length, 3);
  assert.equal(createComplianceCockpitApiRoutes().length, 4);
  assert.equal(createComplianceCockpitOpsRoutes().length, 3);
  assert.equal(createComplianceCockpitPublicRoutes().length, 3);
  assert.equal(createComplianceCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceCockpitFixtures().contacts, 2);
});

