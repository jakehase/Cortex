import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationStudioSnapshot, createActivationStudioDashboardRoutes, createActivationStudioApiRoutes, createActivationStudioOpsRoutes, createActivationStudioPublicRoutes, createActivationStudioRegistryRoutes, summarizeActivationStudioFixtures } from '../packages/activation-studio/index.mjs';

test('activation-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationStudioDashboardRoutes().length, 3);
  assert.equal(createActivationStudioApiRoutes().length, 4);
  assert.equal(createActivationStudioOpsRoutes().length, 3);
  assert.equal(createActivationStudioPublicRoutes().length, 3);
  assert.equal(createActivationStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationStudioFixtures().contacts, 2);
});

