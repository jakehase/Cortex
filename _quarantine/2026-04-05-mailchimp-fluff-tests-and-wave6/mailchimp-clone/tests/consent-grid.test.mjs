import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentGridSnapshot, createConsentGridDashboardRoutes, createConsentGridApiRoutes, createConsentGridOpsRoutes, createConsentGridPublicRoutes, createConsentGridRegistryRoutes, summarizeConsentGridFixtures } from '../packages/consent-grid/index.mjs';

test('consent-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentGridDashboardRoutes().length, 3);
  assert.equal(createConsentGridApiRoutes().length, 4);
  assert.equal(createConsentGridOpsRoutes().length, 3);
  assert.equal(createConsentGridPublicRoutes().length, 3);
  assert.equal(createConsentGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentGridFixtures().contacts, 2);
});

