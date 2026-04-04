import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentHubSnapshot, createConsentHubDashboardRoutes, createConsentHubApiRoutes, createConsentHubOpsRoutes, createConsentHubPublicRoutes, createConsentHubRegistryRoutes, summarizeConsentHubFixtures } from '../packages/consent-hub/index.mjs';

test('consent-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentHubDashboardRoutes().length, 3);
  assert.equal(createConsentHubApiRoutes().length, 4);
  assert.equal(createConsentHubOpsRoutes().length, 3);
  assert.equal(createConsentHubPublicRoutes().length, 3);
  assert.equal(createConsentHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentHubFixtures().contacts, 2);
});

