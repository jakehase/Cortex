import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceNavigatorSnapshot, createAudienceNavigatorDashboardRoutes, createAudienceNavigatorApiRoutes, createAudienceNavigatorOpsRoutes, createAudienceNavigatorPublicRoutes, createAudienceNavigatorRegistryRoutes, summarizeAudienceNavigatorFixtures } from '../packages/audience-navigator/index.mjs';

test('audience-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceNavigatorDashboardRoutes().length, 3);
  assert.equal(createAudienceNavigatorApiRoutes().length, 4);
  assert.equal(createAudienceNavigatorOpsRoutes().length, 3);
  assert.equal(createAudienceNavigatorPublicRoutes().length, 3);
  assert.equal(createAudienceNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceNavigatorFixtures().contacts, 2);
});

