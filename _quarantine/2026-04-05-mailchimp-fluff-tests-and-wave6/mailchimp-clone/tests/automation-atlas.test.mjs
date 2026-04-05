import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationAtlasSnapshot, createAutomationAtlasDashboardRoutes, createAutomationAtlasApiRoutes, createAutomationAtlasOpsRoutes, createAutomationAtlasPublicRoutes, createAutomationAtlasRegistryRoutes, summarizeAutomationAtlasFixtures } from '../packages/automation-atlas/index.mjs';

test('automation-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationAtlasDashboardRoutes().length, 3);
  assert.equal(createAutomationAtlasApiRoutes().length, 4);
  assert.equal(createAutomationAtlasOpsRoutes().length, 3);
  assert.equal(createAutomationAtlasPublicRoutes().length, 3);
  assert.equal(createAutomationAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationAtlasFixtures().contacts, 2);
});

