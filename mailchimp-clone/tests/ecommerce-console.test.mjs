import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceConsoleSnapshot, createEcommerceConsoleDashboardRoutes, createEcommerceConsoleApiRoutes, createEcommerceConsoleOpsRoutes, createEcommerceConsolePublicRoutes, createEcommerceConsoleRegistryRoutes, summarizeEcommerceConsoleFixtures } from '../packages/ecommerce-console/index.mjs';

test('ecommerce-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceConsoleDashboardRoutes().length, 3);
  assert.equal(createEcommerceConsoleApiRoutes().length, 4);
  assert.equal(createEcommerceConsoleOpsRoutes().length, 3);
  assert.equal(createEcommerceConsolePublicRoutes().length, 3);
  assert.equal(createEcommerceConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceConsoleFixtures().contacts, 2);
});

