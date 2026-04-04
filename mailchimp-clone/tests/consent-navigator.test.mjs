import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentNavigatorSnapshot, createConsentNavigatorDashboardRoutes, createConsentNavigatorApiRoutes, createConsentNavigatorOpsRoutes, createConsentNavigatorPublicRoutes, createConsentNavigatorRegistryRoutes, summarizeConsentNavigatorFixtures } from '../packages/consent-navigator/index.mjs';

test('consent-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentNavigatorDashboardRoutes().length, 3);
  assert.equal(createConsentNavigatorApiRoutes().length, 4);
  assert.equal(createConsentNavigatorOpsRoutes().length, 3);
  assert.equal(createConsentNavigatorPublicRoutes().length, 3);
  assert.equal(createConsentNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentNavigatorFixtures().contacts, 2);
});

