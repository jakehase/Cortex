import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingConsoleSnapshot, createBillingConsoleDashboardRoutes, createBillingConsoleApiRoutes, createBillingConsoleOpsRoutes, createBillingConsolePublicRoutes, createBillingConsoleRegistryRoutes, summarizeBillingConsoleFixtures } from '../packages/billing-console/index.mjs';

test('billing-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingConsoleDashboardRoutes().length, 3);
  assert.equal(createBillingConsoleApiRoutes().length, 4);
  assert.equal(createBillingConsoleOpsRoutes().length, 3);
  assert.equal(createBillingConsolePublicRoutes().length, 3);
  assert.equal(createBillingConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingConsoleFixtures().contacts, 2);
});

