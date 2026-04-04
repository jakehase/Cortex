import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentAdvisorSnapshot, createContentAdvisorDashboardRoutes, createContentAdvisorApiRoutes, createContentAdvisorOpsRoutes, createContentAdvisorPublicRoutes, createContentAdvisorRegistryRoutes, summarizeContentAdvisorFixtures } from '../packages/content-advisor/index.mjs';

test('content-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentAdvisorDashboardRoutes().length, 3);
  assert.equal(createContentAdvisorApiRoutes().length, 4);
  assert.equal(createContentAdvisorOpsRoutes().length, 3);
  assert.equal(createContentAdvisorPublicRoutes().length, 3);
  assert.equal(createContentAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentAdvisorFixtures().contacts, 2);
});

