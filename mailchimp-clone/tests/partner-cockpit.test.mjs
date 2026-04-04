import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPartnerCockpitSnapshot, createPartnerCockpitDashboardRoutes, createPartnerCockpitApiRoutes, createPartnerCockpitOpsRoutes, createPartnerCockpitPublicRoutes, createPartnerCockpitRegistryRoutes, summarizePartnerCockpitFixtures } from '../packages/partner-cockpit/index.mjs';

test('partner-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildPartnerCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createPartnerCockpitDashboardRoutes().length, 3);
  assert.equal(createPartnerCockpitApiRoutes().length, 4);
  assert.equal(createPartnerCockpitOpsRoutes().length, 3);
  assert.equal(createPartnerCockpitPublicRoutes().length, 3);
  assert.equal(createPartnerCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizePartnerCockpitFixtures().contacts, 2);
});

