import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationNavigatorSnapshot, createActivationNavigatorDashboardRoutes, createActivationNavigatorApiRoutes, createActivationNavigatorOpsRoutes, createActivationNavigatorPublicRoutes, createActivationNavigatorRegistryRoutes, summarizeActivationNavigatorFixtures } from '../packages/activation-navigator/index.mjs';

test('activation-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationNavigatorDashboardRoutes().length, 3);
  assert.equal(createActivationNavigatorApiRoutes().length, 4);
  assert.equal(createActivationNavigatorOpsRoutes().length, 3);
  assert.equal(createActivationNavigatorPublicRoutes().length, 3);
  assert.equal(createActivationNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationNavigatorFixtures().contacts, 2);
});

