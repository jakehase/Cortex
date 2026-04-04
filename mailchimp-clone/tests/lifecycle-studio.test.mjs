import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleStudioSnapshot, createLifecycleStudioDashboardRoutes, createLifecycleStudioApiRoutes, createLifecycleStudioOpsRoutes, createLifecycleStudioPublicRoutes, createLifecycleStudioRegistryRoutes, summarizeLifecycleStudioFixtures } from '../packages/lifecycle-studio/index.mjs';

test('lifecycle-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleStudioDashboardRoutes().length, 3);
  assert.equal(createLifecycleStudioApiRoutes().length, 4);
  assert.equal(createLifecycleStudioOpsRoutes().length, 3);
  assert.equal(createLifecycleStudioPublicRoutes().length, 3);
  assert.equal(createLifecycleStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleStudioFixtures().contacts, 2);
});

