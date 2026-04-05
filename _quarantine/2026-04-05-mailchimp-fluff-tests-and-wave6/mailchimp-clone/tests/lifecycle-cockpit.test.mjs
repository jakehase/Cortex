import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleCockpitSnapshot, createLifecycleCockpitDashboardRoutes, createLifecycleCockpitApiRoutes, createLifecycleCockpitOpsRoutes, createLifecycleCockpitPublicRoutes, createLifecycleCockpitRegistryRoutes, summarizeLifecycleCockpitFixtures } from '../packages/lifecycle-cockpit/index.mjs';

test('lifecycle-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleCockpitDashboardRoutes().length, 3);
  assert.equal(createLifecycleCockpitApiRoutes().length, 4);
  assert.equal(createLifecycleCockpitOpsRoutes().length, 3);
  assert.equal(createLifecycleCockpitPublicRoutes().length, 3);
  assert.equal(createLifecycleCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleCockpitFixtures().contacts, 2);
});

