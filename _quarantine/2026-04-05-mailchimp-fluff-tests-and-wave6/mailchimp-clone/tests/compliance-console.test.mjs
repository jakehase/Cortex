import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceConsoleSnapshot, createComplianceConsoleDashboardRoutes, createComplianceConsoleApiRoutes, createComplianceConsoleOpsRoutes, createComplianceConsolePublicRoutes, createComplianceConsoleRegistryRoutes, summarizeComplianceConsoleFixtures } from '../packages/compliance-console/index.mjs';

test('compliance-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceConsoleDashboardRoutes().length, 3);
  assert.equal(createComplianceConsoleApiRoutes().length, 4);
  assert.equal(createComplianceConsoleOpsRoutes().length, 3);
  assert.equal(createComplianceConsolePublicRoutes().length, 3);
  assert.equal(createComplianceConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceConsoleFixtures().contacts, 2);
});

