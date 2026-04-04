import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceCockpitSnapshot, createAudienceCockpitDashboardRoutes, createAudienceCockpitApiRoutes, createAudienceCockpitOpsRoutes, createAudienceCockpitPublicRoutes, createAudienceCockpitRegistryRoutes, summarizeAudienceCockpitFixtures } from '../packages/audience-cockpit/index.mjs';

test('audience-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceCockpitDashboardRoutes().length, 3);
  assert.equal(createAudienceCockpitApiRoutes().length, 4);
  assert.equal(createAudienceCockpitOpsRoutes().length, 3);
  assert.equal(createAudienceCockpitPublicRoutes().length, 3);
  assert.equal(createAudienceCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceCockpitFixtures().contacts, 2);
});

