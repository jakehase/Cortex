import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyWorkbenchSnapshot, createAdvocacyWorkbenchDashboardRoutes, createAdvocacyWorkbenchApiRoutes, createAdvocacyWorkbenchOpsRoutes, createAdvocacyWorkbenchPublicRoutes, createAdvocacyWorkbenchRegistryRoutes, summarizeAdvocacyWorkbenchFixtures } from '../packages/advocacy-workbench/index.mjs';

test('advocacy-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyWorkbenchDashboardRoutes().length, 3);
  assert.equal(createAdvocacyWorkbenchApiRoutes().length, 4);
  assert.equal(createAdvocacyWorkbenchOpsRoutes().length, 3);
  assert.equal(createAdvocacyWorkbenchPublicRoutes().length, 3);
  assert.equal(createAdvocacyWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyWorkbenchFixtures().contacts, 2);
});

