import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceCockpitSnapshot, createEcommerceCockpitDashboardRoutes, createEcommerceCockpitApiRoutes, createEcommerceCockpitOpsRoutes, createEcommerceCockpitPublicRoutes, createEcommerceCockpitRegistryRoutes, summarizeEcommerceCockpitFixtures } from '../packages/ecommerce-cockpit/index.mjs';

test('ecommerce-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceCockpitDashboardRoutes().length, 3);
  assert.equal(createEcommerceCockpitApiRoutes().length, 4);
  assert.equal(createEcommerceCockpitOpsRoutes().length, 3);
  assert.equal(createEcommerceCockpitPublicRoutes().length, 3);
  assert.equal(createEcommerceCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceCockpitFixtures().contacts, 2);
});

