import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceIncidentsSnapshot, createComplianceIncidentsDashboardRoutes, createComplianceIncidentsApiRoutes, createComplianceIncidentsOpsRoutes, createComplianceIncidentsPublicRoutes, summarizeComplianceIncidentsFixtures } from '../packages/compliance-incidents/index.mjs';

test('compliance-incidents package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildComplianceIncidentsSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceIncidentsDashboardRoutes().length, 3);
  assert.equal(createComplianceIncidentsApiRoutes().length, 3);
  assert.equal(createComplianceIncidentsOpsRoutes().length, 3);
  assert.equal(createComplianceIncidentsPublicRoutes().length, 3);
  assert.equal(summarizeComplianceIncidentsFixtures().contacts, 2);
});

