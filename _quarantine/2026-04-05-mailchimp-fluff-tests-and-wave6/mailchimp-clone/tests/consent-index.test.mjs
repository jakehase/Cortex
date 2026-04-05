import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentIndexSnapshot, createConsentIndexDashboardRoutes, createConsentIndexApiRoutes, createConsentIndexOpsRoutes, createConsentIndexPublicRoutes, createConsentIndexRegistryRoutes, summarizeConsentIndexFixtures } from '../packages/consent-index/index.mjs';

test('consent-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentIndexDashboardRoutes().length, 3);
  assert.equal(createConsentIndexApiRoutes().length, 4);
  assert.equal(createConsentIndexOpsRoutes().length, 3);
  assert.equal(createConsentIndexPublicRoutes().length, 3);
  assert.equal(createConsentIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentIndexFixtures().contacts, 2);
});

