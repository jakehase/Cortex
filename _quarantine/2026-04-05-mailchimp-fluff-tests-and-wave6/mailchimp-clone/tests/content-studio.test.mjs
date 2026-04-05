import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentStudioSnapshot, createContentStudioDashboardRoutes, createContentStudioApiRoutes, createContentStudioOpsRoutes, createContentStudioPublicRoutes, createContentStudioRegistryRoutes, summarizeContentStudioFixtures } from '../packages/content-studio/index.mjs';

test('content-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentStudioDashboardRoutes().length, 3);
  assert.equal(createContentStudioApiRoutes().length, 4);
  assert.equal(createContentStudioOpsRoutes().length, 3);
  assert.equal(createContentStudioPublicRoutes().length, 3);
  assert.equal(createContentStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentStudioFixtures().contacts, 2);
});

