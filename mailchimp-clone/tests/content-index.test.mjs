import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentIndexSnapshot, createContentIndexDashboardRoutes, createContentIndexApiRoutes, createContentIndexOpsRoutes, createContentIndexPublicRoutes, createContentIndexRegistryRoutes, summarizeContentIndexFixtures } from '../packages/content-index/index.mjs';

test('content-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentIndexDashboardRoutes().length, 3);
  assert.equal(createContentIndexApiRoutes().length, 4);
  assert.equal(createContentIndexOpsRoutes().length, 3);
  assert.equal(createContentIndexPublicRoutes().length, 3);
  assert.equal(createContentIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentIndexFixtures().contacts, 2);
});

