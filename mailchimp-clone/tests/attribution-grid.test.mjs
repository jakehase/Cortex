import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionGridSnapshot, createAttributionGridDashboardRoutes, createAttributionGridApiRoutes, createAttributionGridOpsRoutes, createAttributionGridPublicRoutes, createAttributionGridRegistryRoutes, summarizeAttributionGridFixtures } from '../packages/attribution-grid/index.mjs';

test('attribution-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionGridDashboardRoutes().length, 3);
  assert.equal(createAttributionGridApiRoutes().length, 4);
  assert.equal(createAttributionGridOpsRoutes().length, 3);
  assert.equal(createAttributionGridPublicRoutes().length, 3);
  assert.equal(createAttributionGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionGridFixtures().contacts, 2);
});

