import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionIndexSnapshot, createAttributionIndexDashboardRoutes, createAttributionIndexApiRoutes, createAttributionIndexOpsRoutes, createAttributionIndexPublicRoutes, createAttributionIndexRegistryRoutes, summarizeAttributionIndexFixtures } from '../packages/attribution-index/index.mjs';

test('attribution-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionIndexDashboardRoutes().length, 3);
  assert.equal(createAttributionIndexApiRoutes().length, 4);
  assert.equal(createAttributionIndexOpsRoutes().length, 3);
  assert.equal(createAttributionIndexPublicRoutes().length, 3);
  assert.equal(createAttributionIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionIndexFixtures().contacts, 2);
});

