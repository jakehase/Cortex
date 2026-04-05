import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceFoundrySnapshot, createAudienceFoundryDashboardRoutes, createAudienceFoundryApiRoutes, createAudienceFoundryOpsRoutes, createAudienceFoundryPublicRoutes, createAudienceFoundryRegistryRoutes, summarizeAudienceFoundryFixtures } from '../packages/audience-foundry/index.mjs';

test('audience-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceFoundryDashboardRoutes().length, 3);
  assert.equal(createAudienceFoundryApiRoutes().length, 4);
  assert.equal(createAudienceFoundryOpsRoutes().length, 3);
  assert.equal(createAudienceFoundryPublicRoutes().length, 3);
  assert.equal(createAudienceFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceFoundryFixtures().contacts, 2);
});

