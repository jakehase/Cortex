import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceWatchtowerSnapshot, createAudienceWatchtowerDashboardRoutes, createAudienceWatchtowerApiRoutes, createAudienceWatchtowerOpsRoutes, createAudienceWatchtowerPublicRoutes, createAudienceWatchtowerRegistryRoutes, summarizeAudienceWatchtowerFixtures } from '../packages/audience-watchtower/index.mjs';

test('audience-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceWatchtowerDashboardRoutes().length, 3);
  assert.equal(createAudienceWatchtowerApiRoutes().length, 4);
  assert.equal(createAudienceWatchtowerOpsRoutes().length, 3);
  assert.equal(createAudienceWatchtowerPublicRoutes().length, 3);
  assert.equal(createAudienceWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceWatchtowerFixtures().contacts, 2);
});

