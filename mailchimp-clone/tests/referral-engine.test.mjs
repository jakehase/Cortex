import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReferralEngineSnapshot, createReferralEngineDashboardRoutes, createReferralEngineApiRoutes, createReferralEngineOpsRoutes, createReferralEnginePublicRoutes, summarizeReferralEngineFixtures } from '../packages/referral-engine/index.mjs';

test('referral-engine package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildReferralEngineSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createReferralEngineDashboardRoutes().length, 3);
  assert.equal(createReferralEngineApiRoutes().length, 3);
  assert.equal(createReferralEngineOpsRoutes().length, 3);
  assert.equal(createReferralEnginePublicRoutes().length, 3);
  assert.equal(summarizeReferralEngineFixtures().contacts, 2);
});
