import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelDossierSnapshot, createChannelDossierDashboardRoutes, createChannelDossierApiRoutes, createChannelDossierOpsRoutes, createChannelDossierPublicRoutes, createChannelDossierRegistryRoutes, summarizeChannelDossierFixtures } from '../packages/channel-dossier/index.mjs';

test('channel-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelDossierDashboardRoutes().length, 3);
  assert.equal(createChannelDossierApiRoutes().length, 4);
  assert.equal(createChannelDossierOpsRoutes().length, 3);
  assert.equal(createChannelDossierPublicRoutes().length, 3);
  assert.equal(createChannelDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelDossierFixtures().contacts, 2);
});

