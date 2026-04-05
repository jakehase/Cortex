import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationConsoleSnapshot, createLocalizationConsoleDashboardRoutes, createLocalizationConsoleApiRoutes, createLocalizationConsoleOpsRoutes, createLocalizationConsolePublicRoutes, createLocalizationConsoleRegistryRoutes, summarizeLocalizationConsoleFixtures } from '../packages/localization-console/index.mjs';

test('localization-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationConsoleDashboardRoutes().length, 3);
  assert.equal(createLocalizationConsoleApiRoutes().length, 4);
  assert.equal(createLocalizationConsoleOpsRoutes().length, 3);
  assert.equal(createLocalizationConsolePublicRoutes().length, 3);
  assert.equal(createLocalizationConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationConsoleFixtures().contacts, 2);
});

