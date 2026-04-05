import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationAdvisorSnapshot, createLocalizationAdvisorDashboardRoutes, createLocalizationAdvisorApiRoutes, createLocalizationAdvisorOpsRoutes, createLocalizationAdvisorPublicRoutes, createLocalizationAdvisorRegistryRoutes, summarizeLocalizationAdvisorFixtures } from '../packages/localization-advisor/index.mjs';

test('localization-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationAdvisorDashboardRoutes().length, 3);
  assert.equal(createLocalizationAdvisorApiRoutes().length, 4);
  assert.equal(createLocalizationAdvisorOpsRoutes().length, 3);
  assert.equal(createLocalizationAdvisorPublicRoutes().length, 3);
  assert.equal(createLocalizationAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationAdvisorFixtures().contacts, 2);
});

