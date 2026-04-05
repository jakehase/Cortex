import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPartnerAdvisorSnapshot, createPartnerAdvisorDashboardRoutes, createPartnerAdvisorApiRoutes, createPartnerAdvisorOpsRoutes, createPartnerAdvisorPublicRoutes, createPartnerAdvisorRegistryRoutes, summarizePartnerAdvisorFixtures } from '../packages/partner-advisor/index.mjs';

test('partner-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildPartnerAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createPartnerAdvisorDashboardRoutes().length, 3);
  assert.equal(createPartnerAdvisorApiRoutes().length, 4);
  assert.equal(createPartnerAdvisorOpsRoutes().length, 3);
  assert.equal(createPartnerAdvisorPublicRoutes().length, 3);
  assert.equal(createPartnerAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizePartnerAdvisorFixtures().contacts, 2);
});

