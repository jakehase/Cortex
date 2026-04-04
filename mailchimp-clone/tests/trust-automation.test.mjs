import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrustAutomationSnapshot, createTrustAutomationDashboardRoutes, createTrustAutomationApiRoutes, createTrustAutomationOpsRoutes, createTrustAutomationPublicRoutes, summarizeTrustAutomationFixtures } from '../packages/trust-automation/index.mjs';

test('trust-automation package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildTrustAutomationSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createTrustAutomationDashboardRoutes().length, 3);
  assert.equal(createTrustAutomationApiRoutes().length, 3);
  assert.equal(createTrustAutomationOpsRoutes().length, 3);
  assert.equal(createTrustAutomationPublicRoutes().length, 3);
  assert.equal(summarizeTrustAutomationFixtures().contacts, 2);
});

