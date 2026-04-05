import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyStudioSnapshot, createAdvocacyStudioDashboardRoutes, createAdvocacyStudioApiRoutes, createAdvocacyStudioOpsRoutes, createAdvocacyStudioPublicRoutes, createAdvocacyStudioRegistryRoutes, summarizeAdvocacyStudioFixtures } from '../packages/advocacy-studio/index.mjs';

test('advocacy-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyStudioDashboardRoutes().length, 3);
  assert.equal(createAdvocacyStudioApiRoutes().length, 4);
  assert.equal(createAdvocacyStudioOpsRoutes().length, 3);
  assert.equal(createAdvocacyStudioPublicRoutes().length, 3);
  assert.equal(createAdvocacyStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyStudioFixtures().contacts, 2);
});

