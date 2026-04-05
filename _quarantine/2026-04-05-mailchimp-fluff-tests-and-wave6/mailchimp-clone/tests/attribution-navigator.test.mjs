import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionNavigatorSnapshot, createAttributionNavigatorDashboardRoutes, createAttributionNavigatorApiRoutes, createAttributionNavigatorOpsRoutes, createAttributionNavigatorPublicRoutes, createAttributionNavigatorRegistryRoutes, summarizeAttributionNavigatorFixtures } from '../packages/attribution-navigator/index.mjs';

test('attribution-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionNavigatorDashboardRoutes().length, 3);
  assert.equal(createAttributionNavigatorApiRoutes().length, 4);
  assert.equal(createAttributionNavigatorOpsRoutes().length, 3);
  assert.equal(createAttributionNavigatorPublicRoutes().length, 3);
  assert.equal(createAttributionNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionNavigatorFixtures().contacts, 2);
});

