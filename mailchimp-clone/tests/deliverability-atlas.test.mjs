import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityAtlasSnapshot, createDeliverabilityAtlasDashboardRoutes, createDeliverabilityAtlasApiRoutes, createDeliverabilityAtlasOpsRoutes, createDeliverabilityAtlasPublicRoutes, createDeliverabilityAtlasRegistryRoutes, summarizeDeliverabilityAtlasFixtures } from '../packages/deliverability-atlas/index.mjs';

test('deliverability-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityAtlasDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityAtlasApiRoutes().length, 4);
  assert.equal(createDeliverabilityAtlasOpsRoutes().length, 3);
  assert.equal(createDeliverabilityAtlasPublicRoutes().length, 3);
  assert.equal(createDeliverabilityAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityAtlasFixtures().contacts, 2);
});

