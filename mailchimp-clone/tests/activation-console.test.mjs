import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationConsoleSnapshot, createActivationConsoleDashboardRoutes, createActivationConsoleApiRoutes, createActivationConsoleOpsRoutes, createActivationConsolePublicRoutes, createActivationConsoleRegistryRoutes, summarizeActivationConsoleFixtures } from '../packages/activation-console/index.mjs';

test('activation-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationConsoleDashboardRoutes().length, 3);
  assert.equal(createActivationConsoleApiRoutes().length, 4);
  assert.equal(createActivationConsoleOpsRoutes().length, 3);
  assert.equal(createActivationConsolePublicRoutes().length, 3);
  assert.equal(createActivationConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationConsoleFixtures().contacts, 2);
});

