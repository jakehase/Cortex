import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationIndexSnapshot, createActivationIndexDashboardRoutes, createActivationIndexApiRoutes, createActivationIndexOpsRoutes, createActivationIndexPublicRoutes, createActivationIndexRegistryRoutes, summarizeActivationIndexFixtures } from '../packages/activation-index/index.mjs';

test('activation-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationIndexDashboardRoutes().length, 3);
  assert.equal(createActivationIndexApiRoutes().length, 4);
  assert.equal(createActivationIndexOpsRoutes().length, 3);
  assert.equal(createActivationIndexPublicRoutes().length, 3);
  assert.equal(createActivationIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationIndexFixtures().contacts, 2);
});

