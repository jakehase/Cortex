import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsIndexSnapshot, createIntegrationsIndexDashboardRoutes, createIntegrationsIndexApiRoutes, createIntegrationsIndexOpsRoutes, createIntegrationsIndexPublicRoutes, createIntegrationsIndexRegistryRoutes, summarizeIntegrationsIndexFixtures } from '../packages/integrations-index/index.mjs';

test('integrations-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsIndexDashboardRoutes().length, 3);
  assert.equal(createIntegrationsIndexApiRoutes().length, 4);
  assert.equal(createIntegrationsIndexOpsRoutes().length, 3);
  assert.equal(createIntegrationsIndexPublicRoutes().length, 3);
  assert.equal(createIntegrationsIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsIndexFixtures().contacts, 2);
});

