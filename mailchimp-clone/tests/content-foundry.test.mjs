import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentFoundrySnapshot, createContentFoundryDashboardRoutes, createContentFoundryApiRoutes, createContentFoundryOpsRoutes, createContentFoundryPublicRoutes, createContentFoundryRegistryRoutes, summarizeContentFoundryFixtures } from '../packages/content-foundry/index.mjs';

test('content-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentFoundryDashboardRoutes().length, 3);
  assert.equal(createContentFoundryApiRoutes().length, 4);
  assert.equal(createContentFoundryOpsRoutes().length, 3);
  assert.equal(createContentFoundryPublicRoutes().length, 3);
  assert.equal(createContentFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentFoundryFixtures().contacts, 2);
});

