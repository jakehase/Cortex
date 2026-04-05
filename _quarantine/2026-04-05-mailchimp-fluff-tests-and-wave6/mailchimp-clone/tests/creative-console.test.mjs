import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeConsoleSnapshot, createCreativeConsoleDashboardRoutes, createCreativeConsoleApiRoutes, createCreativeConsoleOpsRoutes, createCreativeConsolePublicRoutes, createCreativeConsoleRegistryRoutes, summarizeCreativeConsoleFixtures } from '../packages/creative-console/index.mjs';

test('creative-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeConsoleDashboardRoutes().length, 3);
  assert.equal(createCreativeConsoleApiRoutes().length, 4);
  assert.equal(createCreativeConsoleOpsRoutes().length, 3);
  assert.equal(createCreativeConsolePublicRoutes().length, 3);
  assert.equal(createCreativeConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeConsoleFixtures().contacts, 2);
});

