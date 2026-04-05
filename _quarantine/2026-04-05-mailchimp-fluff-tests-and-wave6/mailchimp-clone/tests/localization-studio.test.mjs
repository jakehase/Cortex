import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationStudioSnapshot, createLocalizationStudioDashboardRoutes, createLocalizationStudioApiRoutes, createLocalizationStudioOpsRoutes, createLocalizationStudioPublicRoutes, summarizeLocalizationStudioFixtures } from '../packages/localization-studio/index.mjs';

test('localization-studio package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildLocalizationStudioSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationStudioDashboardRoutes().length, 3);
  assert.equal(createLocalizationStudioApiRoutes().length, 3);
  assert.equal(createLocalizationStudioOpsRoutes().length, 3);
  assert.equal(createLocalizationStudioPublicRoutes().length, 3);
  assert.equal(summarizeLocalizationStudioFixtures().contacts, 2);
});
