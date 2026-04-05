import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyFoundrySnapshot, createAdvocacyFoundryDashboardRoutes, createAdvocacyFoundryApiRoutes, createAdvocacyFoundryOpsRoutes, createAdvocacyFoundryPublicRoutes, createAdvocacyFoundryRegistryRoutes, summarizeAdvocacyFoundryFixtures } from '../packages/advocacy-foundry/index.mjs';

test('advocacy-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyFoundryDashboardRoutes().length, 3);
  assert.equal(createAdvocacyFoundryApiRoutes().length, 4);
  assert.equal(createAdvocacyFoundryOpsRoutes().length, 3);
  assert.equal(createAdvocacyFoundryPublicRoutes().length, 3);
  assert.equal(createAdvocacyFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyFoundryFixtures().contacts, 2);
});

