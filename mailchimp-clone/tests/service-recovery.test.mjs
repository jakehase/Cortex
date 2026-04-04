import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceRecoverySnapshot, createServiceRecoveryDashboardRoutes, createServiceRecoveryApiRoutes, createServiceRecoveryOpsRoutes, createServiceRecoveryPublicRoutes, summarizeServiceRecoveryFixtures } from '../packages/service-recovery/index.mjs';

test('service-recovery package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildServiceRecoverySnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createServiceRecoveryDashboardRoutes().length, 3);
  assert.equal(createServiceRecoveryApiRoutes().length, 3);
  assert.equal(createServiceRecoveryOpsRoutes().length, 3);
  assert.equal(createServiceRecoveryPublicRoutes().length, 3);
  assert.equal(summarizeServiceRecoveryFixtures().contacts, 2);
});

