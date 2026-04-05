import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyWatchtowerSnapshot, createAdvocacyWatchtowerDashboardRoutes, createAdvocacyWatchtowerApiRoutes, createAdvocacyWatchtowerOpsRoutes, createAdvocacyWatchtowerPublicRoutes, createAdvocacyWatchtowerRegistryRoutes, summarizeAdvocacyWatchtowerFixtures } from '../packages/advocacy-watchtower/index.mjs';

test('advocacy-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyWatchtowerDashboardRoutes().length, 3);
  assert.equal(createAdvocacyWatchtowerApiRoutes().length, 4);
  assert.equal(createAdvocacyWatchtowerOpsRoutes().length, 3);
  assert.equal(createAdvocacyWatchtowerPublicRoutes().length, 3);
  assert.equal(createAdvocacyWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyWatchtowerFixtures().contacts, 2);
});

