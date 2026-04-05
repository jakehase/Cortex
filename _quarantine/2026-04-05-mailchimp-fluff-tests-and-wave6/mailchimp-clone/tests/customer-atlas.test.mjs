import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerAtlasSnapshot, createCustomerAtlasDashboardRoutes, createCustomerAtlasApiRoutes, createCustomerAtlasOpsRoutes, createCustomerAtlasPublicRoutes, createCustomerAtlasRegistryRoutes, summarizeCustomerAtlasFixtures } from '../packages/customer-atlas/index.mjs';

test('customer-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerAtlasDashboardRoutes().length, 3);
  assert.equal(createCustomerAtlasApiRoutes().length, 4);
  assert.equal(createCustomerAtlasOpsRoutes().length, 3);
  assert.equal(createCustomerAtlasPublicRoutes().length, 3);
  assert.equal(createCustomerAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerAtlasFixtures().contacts, 2);
});

