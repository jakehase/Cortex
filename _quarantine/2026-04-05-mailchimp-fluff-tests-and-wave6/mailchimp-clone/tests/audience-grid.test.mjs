import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceGridSnapshot, createAudienceGridDashboardRoutes, createAudienceGridApiRoutes, createAudienceGridOpsRoutes, createAudienceGridPublicRoutes, createAudienceGridRegistryRoutes, summarizeAudienceGridFixtures } from '../packages/audience-grid/index.mjs';

test('audience-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceGridDashboardRoutes().length, 3);
  assert.equal(createAudienceGridApiRoutes().length, 4);
  assert.equal(createAudienceGridOpsRoutes().length, 3);
  assert.equal(createAudienceGridPublicRoutes().length, 3);
  assert.equal(createAudienceGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceGridFixtures().contacts, 2);
});

