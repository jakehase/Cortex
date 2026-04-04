import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceHubSnapshot, createAudienceHubDashboardRoutes, createAudienceHubApiRoutes, createAudienceHubOpsRoutes, createAudienceHubPublicRoutes, createAudienceHubRegistryRoutes, summarizeAudienceHubFixtures } from '../packages/audience-hub/index.mjs';

test('audience-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceHubDashboardRoutes().length, 3);
  assert.equal(createAudienceHubApiRoutes().length, 4);
  assert.equal(createAudienceHubOpsRoutes().length, 3);
  assert.equal(createAudienceHubPublicRoutes().length, 3);
  assert.equal(createAudienceHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceHubFixtures().contacts, 2);
});

