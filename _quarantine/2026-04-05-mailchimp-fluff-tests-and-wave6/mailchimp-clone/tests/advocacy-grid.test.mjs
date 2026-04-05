import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyGridSnapshot, createAdvocacyGridDashboardRoutes, createAdvocacyGridApiRoutes, createAdvocacyGridOpsRoutes, createAdvocacyGridPublicRoutes, createAdvocacyGridRegistryRoutes, summarizeAdvocacyGridFixtures } from '../packages/advocacy-grid/index.mjs';

test('advocacy-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyGridDashboardRoutes().length, 3);
  assert.equal(createAdvocacyGridApiRoutes().length, 4);
  assert.equal(createAdvocacyGridOpsRoutes().length, 3);
  assert.equal(createAdvocacyGridPublicRoutes().length, 3);
  assert.equal(createAdvocacyGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyGridFixtures().contacts, 2);
});

