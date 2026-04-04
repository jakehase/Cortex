import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleConsoleSnapshot, createLifecycleConsoleDashboardRoutes, createLifecycleConsoleApiRoutes, createLifecycleConsoleOpsRoutes, createLifecycleConsolePublicRoutes, createLifecycleConsoleRegistryRoutes, summarizeLifecycleConsoleFixtures } from '../packages/lifecycle-console/index.mjs';

test('lifecycle-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleConsoleDashboardRoutes().length, 3);
  assert.equal(createLifecycleConsoleApiRoutes().length, 4);
  assert.equal(createLifecycleConsoleOpsRoutes().length, 3);
  assert.equal(createLifecycleConsolePublicRoutes().length, 3);
  assert.equal(createLifecycleConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleConsoleFixtures().contacts, 2);
});

