import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationScorecardSnapshot, createLocalizationScorecardDashboardRoutes, createLocalizationScorecardApiRoutes, createLocalizationScorecardOpsRoutes, createLocalizationScorecardPublicRoutes, createLocalizationScorecardRegistryRoutes, summarizeLocalizationScorecardFixtures } from '../packages/localization-scorecard/index.mjs';

test('localization-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationScorecardDashboardRoutes().length, 3);
  assert.equal(createLocalizationScorecardApiRoutes().length, 4);
  assert.equal(createLocalizationScorecardOpsRoutes().length, 3);
  assert.equal(createLocalizationScorecardPublicRoutes().length, 3);
  assert.equal(createLocalizationScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationScorecardFixtures().contacts, 2);
});

