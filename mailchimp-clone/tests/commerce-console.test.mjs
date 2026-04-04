import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceConsoleSnapshot, createCommerceConsoleDashboardRoutes, createCommerceConsoleApiRoutes, createCommerceConsoleOpsRoutes, createCommerceConsolePublicRoutes, createCommerceConsoleRegistryRoutes, summarizeCommerceConsoleFixtures } from '../packages/commerce-console/index.mjs';

test('commerce-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceConsoleDashboardRoutes().length, 3);
  assert.equal(createCommerceConsoleApiRoutes().length, 4);
  assert.equal(createCommerceConsoleOpsRoutes().length, 3);
  assert.equal(createCommerceConsolePublicRoutes().length, 3);
  assert.equal(createCommerceConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceConsoleFixtures().contacts, 2);
});

