import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationSentinelSnapshot, createLocalizationSentinelDashboardRoutes, createLocalizationSentinelApiRoutes, createLocalizationSentinelOpsRoutes, createLocalizationSentinelPublicRoutes, createLocalizationSentinelRegistryRoutes, summarizeLocalizationSentinelFixtures } from '../packages/localization-sentinel/index.mjs';

test('localization-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationSentinelDashboardRoutes().length, 3);
  assert.equal(createLocalizationSentinelApiRoutes().length, 4);
  assert.equal(createLocalizationSentinelOpsRoutes().length, 3);
  assert.equal(createLocalizationSentinelPublicRoutes().length, 3);
  assert.equal(createLocalizationSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationSentinelFixtures().contacts, 2);
});

