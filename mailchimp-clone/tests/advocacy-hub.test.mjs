import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyHubSnapshot, createAdvocacyHubDashboardRoutes, createAdvocacyHubApiRoutes, createAdvocacyHubOpsRoutes, createAdvocacyHubPublicRoutes, createAdvocacyHubRegistryRoutes, summarizeAdvocacyHubFixtures } from '../packages/advocacy-hub/index.mjs';

test('advocacy-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyHubDashboardRoutes().length, 3);
  assert.equal(createAdvocacyHubApiRoutes().length, 4);
  assert.equal(createAdvocacyHubOpsRoutes().length, 3);
  assert.equal(createAdvocacyHubPublicRoutes().length, 3);
  assert.equal(createAdvocacyHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyHubFixtures().contacts, 2);
});

