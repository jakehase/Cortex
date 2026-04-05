import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentWorkbenchSnapshot, createConsentWorkbenchDashboardRoutes, createConsentWorkbenchApiRoutes, createConsentWorkbenchOpsRoutes, createConsentWorkbenchPublicRoutes, createConsentWorkbenchRegistryRoutes, summarizeConsentWorkbenchFixtures } from '../packages/consent-workbench/index.mjs';

test('consent-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentWorkbenchDashboardRoutes().length, 3);
  assert.equal(createConsentWorkbenchApiRoutes().length, 4);
  assert.equal(createConsentWorkbenchOpsRoutes().length, 3);
  assert.equal(createConsentWorkbenchPublicRoutes().length, 3);
  assert.equal(createConsentWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentWorkbenchFixtures().contacts, 2);
});

