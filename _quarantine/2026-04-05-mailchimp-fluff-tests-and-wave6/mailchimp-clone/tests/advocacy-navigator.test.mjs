import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyNavigatorSnapshot, createAdvocacyNavigatorDashboardRoutes, createAdvocacyNavigatorApiRoutes, createAdvocacyNavigatorOpsRoutes, createAdvocacyNavigatorPublicRoutes, createAdvocacyNavigatorRegistryRoutes, summarizeAdvocacyNavigatorFixtures } from '../packages/advocacy-navigator/index.mjs';

test('advocacy-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyNavigatorDashboardRoutes().length, 3);
  assert.equal(createAdvocacyNavigatorApiRoutes().length, 4);
  assert.equal(createAdvocacyNavigatorOpsRoutes().length, 3);
  assert.equal(createAdvocacyNavigatorPublicRoutes().length, 3);
  assert.equal(createAdvocacyNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyNavigatorFixtures().contacts, 2);
});

