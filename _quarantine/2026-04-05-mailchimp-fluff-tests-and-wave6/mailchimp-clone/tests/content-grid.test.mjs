import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentGridSnapshot, createContentGridDashboardRoutes, createContentGridApiRoutes, createContentGridOpsRoutes, createContentGridPublicRoutes, createContentGridRegistryRoutes, summarizeContentGridFixtures } from '../packages/content-grid/index.mjs';

test('content-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentGridDashboardRoutes().length, 3);
  assert.equal(createContentGridApiRoutes().length, 4);
  assert.equal(createContentGridOpsRoutes().length, 3);
  assert.equal(createContentGridPublicRoutes().length, 3);
  assert.equal(createContentGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentGridFixtures().contacts, 2);
});

