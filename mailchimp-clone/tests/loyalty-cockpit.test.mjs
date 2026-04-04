import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyCockpitSnapshot, createLoyaltyCockpitDashboardRoutes, createLoyaltyCockpitApiRoutes, createLoyaltyCockpitOpsRoutes, createLoyaltyCockpitPublicRoutes, createLoyaltyCockpitRegistryRoutes, summarizeLoyaltyCockpitFixtures } from '../packages/loyalty-cockpit/index.mjs';

test('loyalty-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyCockpitDashboardRoutes().length, 3);
  assert.equal(createLoyaltyCockpitApiRoutes().length, 4);
  assert.equal(createLoyaltyCockpitOpsRoutes().length, 3);
  assert.equal(createLoyaltyCockpitPublicRoutes().length, 3);
  assert.equal(createLoyaltyCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyCockpitFixtures().contacts, 2);
});

