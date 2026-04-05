import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceIndexSnapshot, createAudienceIndexDashboardRoutes, createAudienceIndexApiRoutes, createAudienceIndexOpsRoutes, createAudienceIndexPublicRoutes, createAudienceIndexRegistryRoutes, summarizeAudienceIndexFixtures } from '../packages/audience-index/index.mjs';

test('audience-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceIndexDashboardRoutes().length, 3);
  assert.equal(createAudienceIndexApiRoutes().length, 4);
  assert.equal(createAudienceIndexOpsRoutes().length, 3);
  assert.equal(createAudienceIndexPublicRoutes().length, 3);
  assert.equal(createAudienceIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceIndexFixtures().contacts, 2);
});

