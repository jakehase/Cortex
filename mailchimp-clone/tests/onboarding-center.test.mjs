import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOnboardingCenterSnapshot, createOnboardingCenterDashboardRoutes, createOnboardingCenterApiRoutes, createOnboardingCenterOpsRoutes, createOnboardingCenterPublicRoutes, summarizeOnboardingCenterFixtures } from '../packages/onboarding-center/index.mjs';

test('onboarding-center package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildOnboardingCenterSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createOnboardingCenterDashboardRoutes().length, 3);
  assert.equal(createOnboardingCenterApiRoutes().length, 3);
  assert.equal(createOnboardingCenterOpsRoutes().length, 3);
  assert.equal(createOnboardingCenterPublicRoutes().length, 3);
  assert.equal(summarizeOnboardingCenterFixtures().contacts, 2);
});
