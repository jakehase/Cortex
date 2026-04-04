import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadScoringSnapshot, createLeadScoringDashboardRoutes, createLeadScoringApiRoutes, createLeadScoringOpsRoutes, createLeadScoringPublicRoutes, summarizeLeadScoringFixtures } from '../packages/lead-scoring/index.mjs';

test('lead-scoring package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildLeadScoringSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLeadScoringDashboardRoutes().length, 3);
  assert.equal(createLeadScoringApiRoutes().length, 3);
  assert.equal(createLeadScoringOpsRoutes().length, 3);
  assert.equal(createLeadScoringPublicRoutes().length, 3);
  assert.equal(summarizeLeadScoringFixtures().contacts, 2);
});
