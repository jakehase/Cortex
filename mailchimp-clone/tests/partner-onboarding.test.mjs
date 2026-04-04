import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPartnerOnboardingSnapshot, createPartnerOnboardingDashboardRoutes, createPartnerOnboardingApiRoutes, createPartnerOnboardingOpsRoutes, createPartnerOnboardingPublicRoutes, summarizePartnerOnboardingFixtures } from '../packages/partner-onboarding/index.mjs';

test('partner-onboarding package deepens continuation breadth and route catalogs', () => {
  const snapshot = buildPartnerOnboardingSnapshot('Continuation Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Continuation Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createPartnerOnboardingDashboardRoutes().length, 3);
  assert.equal(createPartnerOnboardingApiRoutes().length, 3);
  assert.equal(createPartnerOnboardingOpsRoutes().length, 3);
  assert.equal(createPartnerOnboardingPublicRoutes().length, 3);
  assert.equal(summarizePartnerOnboardingFixtures().contacts, 2);
});
