import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationExchangeSnapshot, createLocalizationExchangeDashboardRoutes, createLocalizationExchangeApiRoutes, createLocalizationExchangeOpsRoutes, createLocalizationExchangePublicRoutes, createLocalizationExchangeRegistryRoutes, summarizeLocalizationExchangeFixtures } from '../packages/localization-exchange/index.mjs';

test('localization-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationExchangeDashboardRoutes().length, 3);
  assert.equal(createLocalizationExchangeApiRoutes().length, 4);
  assert.equal(createLocalizationExchangeOpsRoutes().length, 3);
  assert.equal(createLocalizationExchangePublicRoutes().length, 3);
  assert.equal(createLocalizationExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationExchangeFixtures().contacts, 2);
});

