import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityConsoleSnapshot, createDeliverabilityConsoleDashboardRoutes, createDeliverabilityConsoleApiRoutes, createDeliverabilityConsoleOpsRoutes, createDeliverabilityConsolePublicRoutes, createDeliverabilityConsoleRegistryRoutes, summarizeDeliverabilityConsoleFixtures } from '../packages/deliverability-console/index.mjs';

test('deliverability-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityConsoleDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityConsoleApiRoutes().length, 4);
  assert.equal(createDeliverabilityConsoleOpsRoutes().length, 3);
  assert.equal(createDeliverabilityConsolePublicRoutes().length, 3);
  assert.equal(createDeliverabilityConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityConsoleFixtures().contacts, 2);
});

