import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationGridSnapshot, createActivationGridDashboardRoutes, createActivationGridApiRoutes, createActivationGridOpsRoutes, createActivationGridPublicRoutes, createActivationGridRegistryRoutes, summarizeActivationGridFixtures } from '../packages/activation-grid/index.mjs';

test('activation-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationGridDashboardRoutes().length, 3);
  assert.equal(createActivationGridApiRoutes().length, 4);
  assert.equal(createActivationGridOpsRoutes().length, 3);
  assert.equal(createActivationGridPublicRoutes().length, 3);
  assert.equal(createActivationGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationGridFixtures().contacts, 2);
});

