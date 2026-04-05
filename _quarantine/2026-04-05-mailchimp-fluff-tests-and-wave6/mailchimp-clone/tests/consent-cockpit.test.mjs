import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentCockpitSnapshot, createConsentCockpitDashboardRoutes, createConsentCockpitApiRoutes, createConsentCockpitOpsRoutes, createConsentCockpitPublicRoutes, createConsentCockpitRegistryRoutes, summarizeConsentCockpitFixtures } from '../packages/consent-cockpit/index.mjs';

test('consent-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentCockpitDashboardRoutes().length, 3);
  assert.equal(createConsentCockpitApiRoutes().length, 4);
  assert.equal(createConsentCockpitOpsRoutes().length, 3);
  assert.equal(createConsentCockpitPublicRoutes().length, 3);
  assert.equal(createConsentCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentCockpitFixtures().contacts, 2);
});

