import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentSentinelSnapshot, createConsentSentinelDashboardRoutes, createConsentSentinelApiRoutes, createConsentSentinelOpsRoutes, createConsentSentinelPublicRoutes, createConsentSentinelRegistryRoutes, summarizeConsentSentinelFixtures } from '../packages/consent-sentinel/index.mjs';

test('consent-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentSentinelDashboardRoutes().length, 3);
  assert.equal(createConsentSentinelApiRoutes().length, 4);
  assert.equal(createConsentSentinelOpsRoutes().length, 3);
  assert.equal(createConsentSentinelPublicRoutes().length, 3);
  assert.equal(createConsentSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentSentinelFixtures().contacts, 2);
});

