import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceWorkbenchSnapshot, createAudienceWorkbenchDashboardRoutes, createAudienceWorkbenchApiRoutes, createAudienceWorkbenchOpsRoutes, createAudienceWorkbenchPublicRoutes, createAudienceWorkbenchRegistryRoutes, summarizeAudienceWorkbenchFixtures } from '../packages/audience-workbench/index.mjs';

test('audience-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceWorkbenchDashboardRoutes().length, 3);
  assert.equal(createAudienceWorkbenchApiRoutes().length, 4);
  assert.equal(createAudienceWorkbenchOpsRoutes().length, 3);
  assert.equal(createAudienceWorkbenchPublicRoutes().length, 3);
  assert.equal(createAudienceWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceWorkbenchFixtures().contacts, 2);
});

