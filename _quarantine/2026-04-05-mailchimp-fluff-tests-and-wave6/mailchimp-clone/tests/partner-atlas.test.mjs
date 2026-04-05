import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPartnerAtlasSnapshot, createPartnerAtlasDashboardRoutes, createPartnerAtlasApiRoutes, createPartnerAtlasOpsRoutes, createPartnerAtlasPublicRoutes, createPartnerAtlasRegistryRoutes, summarizePartnerAtlasFixtures } from '../packages/partner-atlas/index.mjs';

test('partner-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildPartnerAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createPartnerAtlasDashboardRoutes().length, 3);
  assert.equal(createPartnerAtlasApiRoutes().length, 4);
  assert.equal(createPartnerAtlasOpsRoutes().length, 3);
  assert.equal(createPartnerAtlasPublicRoutes().length, 3);
  assert.equal(createPartnerAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizePartnerAtlasFixtures().contacts, 2);
});

