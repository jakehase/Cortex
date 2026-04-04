import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataConsoleSnapshot, createDataConsoleDashboardRoutes, createDataConsoleApiRoutes, createDataConsoleOpsRoutes, createDataConsolePublicRoutes, createDataConsoleRegistryRoutes, summarizeDataConsoleFixtures } from '../packages/data-console/index.mjs';

test('data-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataConsoleDashboardRoutes().length, 3);
  assert.equal(createDataConsoleApiRoutes().length, 4);
  assert.equal(createDataConsoleOpsRoutes().length, 3);
  assert.equal(createDataConsolePublicRoutes().length, 3);
  assert.equal(createDataConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataConsoleFixtures().contacts, 2);
});

