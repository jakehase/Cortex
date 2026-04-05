import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentWatchtowerSnapshot, createConsentWatchtowerDashboardRoutes, createConsentWatchtowerApiRoutes, createConsentWatchtowerOpsRoutes, createConsentWatchtowerPublicRoutes, createConsentWatchtowerRegistryRoutes, summarizeConsentWatchtowerFixtures } from '../packages/consent-watchtower/index.mjs';

test('consent-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentWatchtowerDashboardRoutes().length, 3);
  assert.equal(createConsentWatchtowerApiRoutes().length, 4);
  assert.equal(createConsentWatchtowerOpsRoutes().length, 3);
  assert.equal(createConsentWatchtowerPublicRoutes().length, 3);
  assert.equal(createConsentWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentWatchtowerFixtures().contacts, 2);
});

