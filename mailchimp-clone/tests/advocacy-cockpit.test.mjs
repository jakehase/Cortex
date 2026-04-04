import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyCockpitSnapshot, createAdvocacyCockpitDashboardRoutes, createAdvocacyCockpitApiRoutes, createAdvocacyCockpitOpsRoutes, createAdvocacyCockpitPublicRoutes, createAdvocacyCockpitRegistryRoutes, summarizeAdvocacyCockpitFixtures } from '../packages/advocacy-cockpit/index.mjs';

test('advocacy-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyCockpitDashboardRoutes().length, 3);
  assert.equal(createAdvocacyCockpitApiRoutes().length, 4);
  assert.equal(createAdvocacyCockpitOpsRoutes().length, 3);
  assert.equal(createAdvocacyCockpitPublicRoutes().length, 3);
  assert.equal(createAdvocacyCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyCockpitFixtures().contacts, 2);
});

