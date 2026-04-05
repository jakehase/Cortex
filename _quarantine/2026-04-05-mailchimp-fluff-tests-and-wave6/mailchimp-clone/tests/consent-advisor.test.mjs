import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentAdvisorSnapshot, createConsentAdvisorDashboardRoutes, createConsentAdvisorApiRoutes, createConsentAdvisorOpsRoutes, createConsentAdvisorPublicRoutes, createConsentAdvisorRegistryRoutes, summarizeConsentAdvisorFixtures } from '../packages/consent-advisor/index.mjs';

test('consent-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentAdvisorDashboardRoutes().length, 3);
  assert.equal(createConsentAdvisorApiRoutes().length, 4);
  assert.equal(createConsentAdvisorOpsRoutes().length, 3);
  assert.equal(createConsentAdvisorPublicRoutes().length, 3);
  assert.equal(createConsentAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentAdvisorFixtures().contacts, 2);
});

