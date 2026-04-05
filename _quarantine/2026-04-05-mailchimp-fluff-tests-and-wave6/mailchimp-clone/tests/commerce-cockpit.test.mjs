import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceCockpitSnapshot, createCommerceCockpitDashboardRoutes, createCommerceCockpitApiRoutes, createCommerceCockpitOpsRoutes, createCommerceCockpitPublicRoutes, createCommerceCockpitRegistryRoutes, summarizeCommerceCockpitFixtures } from '../packages/commerce-cockpit/index.mjs';

test('commerce-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceCockpitDashboardRoutes().length, 3);
  assert.equal(createCommerceCockpitApiRoutes().length, 4);
  assert.equal(createCommerceCockpitOpsRoutes().length, 3);
  assert.equal(createCommerceCockpitPublicRoutes().length, 3);
  assert.equal(createCommerceCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceCockpitFixtures().contacts, 2);
});

