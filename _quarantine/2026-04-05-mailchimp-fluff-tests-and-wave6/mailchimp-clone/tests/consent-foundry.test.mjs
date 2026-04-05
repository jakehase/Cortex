import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentFoundrySnapshot, createConsentFoundryDashboardRoutes, createConsentFoundryApiRoutes, createConsentFoundryOpsRoutes, createConsentFoundryPublicRoutes, createConsentFoundryRegistryRoutes, summarizeConsentFoundryFixtures } from '../packages/consent-foundry/index.mjs';

test('consent-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentFoundryDashboardRoutes().length, 3);
  assert.equal(createConsentFoundryApiRoutes().length, 4);
  assert.equal(createConsentFoundryOpsRoutes().length, 3);
  assert.equal(createConsentFoundryPublicRoutes().length, 3);
  assert.equal(createConsentFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentFoundryFixtures().contacts, 2);
});

