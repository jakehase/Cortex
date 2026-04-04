import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyConsoleSnapshot, createLoyaltyConsoleDashboardRoutes, createLoyaltyConsoleApiRoutes, createLoyaltyConsoleOpsRoutes, createLoyaltyConsolePublicRoutes, createLoyaltyConsoleRegistryRoutes, summarizeLoyaltyConsoleFixtures } from '../packages/loyalty-console/index.mjs';

test('loyalty-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyConsoleDashboardRoutes().length, 3);
  assert.equal(createLoyaltyConsoleApiRoutes().length, 4);
  assert.equal(createLoyaltyConsoleOpsRoutes().length, 3);
  assert.equal(createLoyaltyConsolePublicRoutes().length, 3);
  assert.equal(createLoyaltyConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyConsoleFixtures().contacts, 2);
});

