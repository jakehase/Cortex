import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionExchangeSnapshot, createAcquisitionExchangeDashboardRoutes, createAcquisitionExchangeApiRoutes, createAcquisitionExchangeOpsRoutes, createAcquisitionExchangePublicRoutes, createAcquisitionExchangeRegistryRoutes, summarizeAcquisitionExchangeFixtures } from '../packages/acquisition-exchange/index.mjs';

test('acquisition-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionExchangeDashboardRoutes().length, 3);
  assert.equal(createAcquisitionExchangeApiRoutes().length, 4);
  assert.equal(createAcquisitionExchangeOpsRoutes().length, 3);
  assert.equal(createAcquisitionExchangePublicRoutes().length, 3);
  assert.equal(createAcquisitionExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionExchangeFixtures().contacts, 2);
});

