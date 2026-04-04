import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupportPlaybooksSnapshot, createSupportPlaybooksDashboardRoutes, createSupportPlaybooksApiRoutes, createSupportPlaybooksOpsRoutes, createSupportPlaybooksPublicRoutes, summarizeSupportPlaybooksFixtures } from '../packages/support-playbooks/index.mjs';

test('support-playbooks package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildSupportPlaybooksSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createSupportPlaybooksDashboardRoutes().length, 3);
  assert.equal(createSupportPlaybooksApiRoutes().length, 3);
  assert.equal(createSupportPlaybooksOpsRoutes().length, 3);
  assert.equal(createSupportPlaybooksPublicRoutes().length, 3);
  assert.equal(summarizeSupportPlaybooksFixtures().contacts, 2);
});
