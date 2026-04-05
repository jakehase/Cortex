import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyIndexSnapshot, createAdvocacyIndexDashboardRoutes, createAdvocacyIndexApiRoutes, createAdvocacyIndexOpsRoutes, createAdvocacyIndexPublicRoutes, createAdvocacyIndexRegistryRoutes, summarizeAdvocacyIndexFixtures } from '../packages/advocacy-index/index.mjs';

test('advocacy-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyIndexDashboardRoutes().length, 3);
  assert.equal(createAdvocacyIndexApiRoutes().length, 4);
  assert.equal(createAdvocacyIndexOpsRoutes().length, 3);
  assert.equal(createAdvocacyIndexPublicRoutes().length, 3);
  assert.equal(createAdvocacyIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyIndexFixtures().contacts, 2);
});

