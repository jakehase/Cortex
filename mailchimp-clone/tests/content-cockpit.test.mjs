import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentCockpitSnapshot, createContentCockpitDashboardRoutes, createContentCockpitApiRoutes, createContentCockpitOpsRoutes, createContentCockpitPublicRoutes, createContentCockpitRegistryRoutes, summarizeContentCockpitFixtures } from '../packages/content-cockpit/index.mjs';

test('content-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentCockpitDashboardRoutes().length, 3);
  assert.equal(createContentCockpitApiRoutes().length, 4);
  assert.equal(createContentCockpitOpsRoutes().length, 3);
  assert.equal(createContentCockpitPublicRoutes().length, 3);
  assert.equal(createContentCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentCockpitFixtures().contacts, 2);
});

