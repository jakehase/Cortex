import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingAtlasSnapshot, createBillingAtlasDashboardRoutes, createBillingAtlasApiRoutes, createBillingAtlasOpsRoutes, createBillingAtlasPublicRoutes, createBillingAtlasRegistryRoutes, summarizeBillingAtlasFixtures } from '../packages/billing-atlas/index.mjs';

test('billing-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingAtlasDashboardRoutes().length, 3);
  assert.equal(createBillingAtlasApiRoutes().length, 4);
  assert.equal(createBillingAtlasOpsRoutes().length, 3);
  assert.equal(createBillingAtlasPublicRoutes().length, 3);
  assert.equal(createBillingAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingAtlasFixtures().contacts, 2);
});

