import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentScorecardSnapshot, createConsentScorecardDashboardRoutes, createConsentScorecardApiRoutes, createConsentScorecardOpsRoutes, createConsentScorecardPublicRoutes, createConsentScorecardRegistryRoutes, summarizeConsentScorecardFixtures } from '../packages/consent-scorecard/index.mjs';

test('consent-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentScorecardDashboardRoutes().length, 3);
  assert.equal(createConsentScorecardApiRoutes().length, 4);
  assert.equal(createConsentScorecardOpsRoutes().length, 3);
  assert.equal(createConsentScorecardPublicRoutes().length, 3);
  assert.equal(createConsentScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentScorecardFixtures().contacts, 2);
});

