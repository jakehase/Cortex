import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceStudioSnapshot, createAudienceStudioDashboardRoutes, createAudienceStudioApiRoutes, createAudienceStudioOpsRoutes, createAudienceStudioPublicRoutes, createAudienceStudioRegistryRoutes, summarizeAudienceStudioFixtures } from '../packages/audience-studio/index.mjs';

test('audience-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceStudioDashboardRoutes().length, 3);
  assert.equal(createAudienceStudioApiRoutes().length, 4);
  assert.equal(createAudienceStudioOpsRoutes().length, 3);
  assert.equal(createAudienceStudioPublicRoutes().length, 3);
  assert.equal(createAudienceStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceStudioFixtures().contacts, 2);
});

