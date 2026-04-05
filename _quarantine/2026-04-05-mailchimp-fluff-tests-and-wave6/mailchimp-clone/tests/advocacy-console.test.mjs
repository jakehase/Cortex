import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyConsoleSnapshot, createAdvocacyConsoleDashboardRoutes, createAdvocacyConsoleApiRoutes, createAdvocacyConsoleOpsRoutes, createAdvocacyConsolePublicRoutes, createAdvocacyConsoleRegistryRoutes, summarizeAdvocacyConsoleFixtures } from '../packages/advocacy-console/index.mjs';

test('advocacy-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyConsoleDashboardRoutes().length, 3);
  assert.equal(createAdvocacyConsoleApiRoutes().length, 4);
  assert.equal(createAdvocacyConsoleOpsRoutes().length, 3);
  assert.equal(createAdvocacyConsolePublicRoutes().length, 3);
  assert.equal(createAdvocacyConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyConsoleFixtures().contacts, 2);
});

