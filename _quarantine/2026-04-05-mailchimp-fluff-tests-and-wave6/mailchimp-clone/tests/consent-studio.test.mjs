import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentStudioSnapshot, createConsentStudioDashboardRoutes, createConsentStudioApiRoutes, createConsentStudioOpsRoutes, createConsentStudioPublicRoutes, createConsentStudioRegistryRoutes, summarizeConsentStudioFixtures } from '../packages/consent-studio/index.mjs';

test('consent-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentStudioDashboardRoutes().length, 3);
  assert.equal(createConsentStudioApiRoutes().length, 4);
  assert.equal(createConsentStudioOpsRoutes().length, 3);
  assert.equal(createConsentStudioPublicRoutes().length, 3);
  assert.equal(createConsentStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentStudioFixtures().contacts, 2);
});

