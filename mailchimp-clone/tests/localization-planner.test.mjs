import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationPlannerSnapshot, createLocalizationPlannerDashboardRoutes, createLocalizationPlannerApiRoutes, createLocalizationPlannerOpsRoutes, createLocalizationPlannerPublicRoutes, createLocalizationPlannerRegistryRoutes, summarizeLocalizationPlannerFixtures } from '../packages/localization-planner/index.mjs';

test('localization-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationPlannerDashboardRoutes().length, 3);
  assert.equal(createLocalizationPlannerApiRoutes().length, 4);
  assert.equal(createLocalizationPlannerOpsRoutes().length, 3);
  assert.equal(createLocalizationPlannerPublicRoutes().length, 3);
  assert.equal(createLocalizationPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationPlannerFixtures().contacts, 2);
});

