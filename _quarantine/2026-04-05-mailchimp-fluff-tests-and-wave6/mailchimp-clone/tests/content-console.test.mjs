import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentConsoleSnapshot, createContentConsoleDashboardRoutes, createContentConsoleApiRoutes, createContentConsoleOpsRoutes, createContentConsolePublicRoutes, createContentConsoleRegistryRoutes, summarizeContentConsoleFixtures } from '../packages/content-console/index.mjs';

test('content-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentConsoleDashboardRoutes().length, 3);
  assert.equal(createContentConsoleApiRoutes().length, 4);
  assert.equal(createContentConsoleOpsRoutes().length, 3);
  assert.equal(createContentConsolePublicRoutes().length, 3);
  assert.equal(createContentConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentConsoleFixtures().contacts, 2);
});

