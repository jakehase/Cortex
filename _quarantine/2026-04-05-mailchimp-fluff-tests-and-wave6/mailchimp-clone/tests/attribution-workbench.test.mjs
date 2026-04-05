import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionWorkbenchSnapshot, createAttributionWorkbenchDashboardRoutes, createAttributionWorkbenchApiRoutes, createAttributionWorkbenchOpsRoutes, createAttributionWorkbenchPublicRoutes, createAttributionWorkbenchRegistryRoutes, summarizeAttributionWorkbenchFixtures } from '../packages/attribution-workbench/index.mjs';

test('attribution-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionWorkbenchDashboardRoutes().length, 3);
  assert.equal(createAttributionWorkbenchApiRoutes().length, 4);
  assert.equal(createAttributionWorkbenchOpsRoutes().length, 3);
  assert.equal(createAttributionWorkbenchPublicRoutes().length, 3);
  assert.equal(createAttributionWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionWorkbenchFixtures().contacts, 2);
});

