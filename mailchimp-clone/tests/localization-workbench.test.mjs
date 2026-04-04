import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationWorkbenchSnapshot, createLocalizationWorkbenchDashboardRoutes, createLocalizationWorkbenchApiRoutes, createLocalizationWorkbenchOpsRoutes, createLocalizationWorkbenchPublicRoutes, createLocalizationWorkbenchRegistryRoutes, summarizeLocalizationWorkbenchFixtures } from '../packages/localization-workbench/index.mjs';

test('localization-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationWorkbenchDashboardRoutes().length, 3);
  assert.equal(createLocalizationWorkbenchApiRoutes().length, 4);
  assert.equal(createLocalizationWorkbenchOpsRoutes().length, 3);
  assert.equal(createLocalizationWorkbenchPublicRoutes().length, 3);
  assert.equal(createLocalizationWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationWorkbenchFixtures().contacts, 2);
});

