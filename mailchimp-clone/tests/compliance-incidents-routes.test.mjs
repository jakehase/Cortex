import test from 'node:test';
import assert from 'node:assert/strict';
import { createComplianceIncidentsDashboardRoutes, createComplianceIncidentsApiRoutes, createComplianceIncidentsOpsRoutes, createComplianceIncidentsPublicRoutes } from '../packages/compliance-incidents/index.mjs';

test('compliance-incidents routes honor custom base paths and stable ids', () => {
  const dashboard = createComplianceIncidentsDashboardRoutes('/labs/compliance-incidents');
  const api = createComplianceIncidentsApiRoutes('/api/labs/compliance-incidents');
  const ops = createComplianceIncidentsOpsRoutes('/ops/labs/compliance-incidents');
  const pub = createComplianceIncidentsPublicRoutes('/public/labs/compliance-incidents');
  assert.equal(dashboard[0].path, '/labs/compliance-incidents');
  assert.equal(api[0].path, '/api/labs/compliance-incidents/overview');
  assert.equal(ops[0].path, '/ops/labs/compliance-incidents/health');
  assert.equal(pub[0].path, '/public/labs/compliance-incidents');
  assert.match(dashboard[0].id, /compliance\-incidents/);
  assert.match(api[2].id, /compliance\-incidents/);
});

