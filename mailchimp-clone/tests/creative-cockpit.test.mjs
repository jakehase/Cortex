import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeCockpitSnapshot, createCreativeCockpitDashboardRoutes, createCreativeCockpitApiRoutes, createCreativeCockpitOpsRoutes, createCreativeCockpitPublicRoutes, createCreativeCockpitRegistryRoutes, summarizeCreativeCockpitFixtures } from '../packages/creative-cockpit/index.mjs';

test('creative-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeCockpitDashboardRoutes().length, 3);
  assert.equal(createCreativeCockpitApiRoutes().length, 4);
  assert.equal(createCreativeCockpitOpsRoutes().length, 3);
  assert.equal(createCreativeCockpitPublicRoutes().length, 3);
  assert.equal(createCreativeCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeCockpitFixtures().contacts, 2);
});

