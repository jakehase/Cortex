import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionConsoleSnapshot, createAttributionConsoleDashboardRoutes, createAttributionConsoleApiRoutes, createAttributionConsoleOpsRoutes, createAttributionConsolePublicRoutes, createAttributionConsoleRegistryRoutes, summarizeAttributionConsoleFixtures } from '../packages/attribution-console/index.mjs';

test('attribution-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionConsoleDashboardRoutes().length, 3);
  assert.equal(createAttributionConsoleApiRoutes().length, 4);
  assert.equal(createAttributionConsoleOpsRoutes().length, 3);
  assert.equal(createAttributionConsolePublicRoutes().length, 3);
  assert.equal(createAttributionConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionConsoleFixtures().contacts, 2);
});

