import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsDossierSnapshot, createInsightsDossierDashboardRoutes, createInsightsDossierApiRoutes, createInsightsDossierOpsRoutes, createInsightsDossierPublicRoutes, createInsightsDossierRegistryRoutes, summarizeInsightsDossierFixtures } from '../packages/insights-dossier/index.mjs';

test('insights-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsDossierDashboardRoutes().length, 3);
  assert.equal(createInsightsDossierApiRoutes().length, 4);
  assert.equal(createInsightsDossierOpsRoutes().length, 3);
  assert.equal(createInsightsDossierPublicRoutes().length, 3);
  assert.equal(createInsightsDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsDossierFixtures().contacts, 2);
});

