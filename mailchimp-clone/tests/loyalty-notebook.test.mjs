import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyNotebookSnapshot, createLoyaltyNotebookDashboardRoutes, createLoyaltyNotebookApiRoutes, createLoyaltyNotebookOpsRoutes, createLoyaltyNotebookPublicRoutes, createLoyaltyNotebookRegistryRoutes, summarizeLoyaltyNotebookFixtures } from '../packages/loyalty-notebook/index.mjs';

test('loyalty-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyNotebookDashboardRoutes().length, 3);
  assert.equal(createLoyaltyNotebookApiRoutes().length, 4);
  assert.equal(createLoyaltyNotebookOpsRoutes().length, 3);
  assert.equal(createLoyaltyNotebookPublicRoutes().length, 3);
  assert.equal(createLoyaltyNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyNotebookFixtures().contacts, 2);
});

