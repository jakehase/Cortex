import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsDossierSnapshot, createAnalyticsDossierDashboardRoutes, createAnalyticsDossierApiRoutes, createAnalyticsDossierOpsRoutes, createAnalyticsDossierPublicRoutes, createAnalyticsDossierRegistryRoutes, summarizeAnalyticsDossierFixtures } from '../packages/analytics-dossier/index.mjs';

test('analytics-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsDossierDashboardRoutes().length, 3);
  assert.equal(createAnalyticsDossierApiRoutes().length, 4);
  assert.equal(createAnalyticsDossierOpsRoutes().length, 3);
  assert.equal(createAnalyticsDossierPublicRoutes().length, 3);
  assert.equal(createAnalyticsDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsDossierFixtures().contacts, 2);
});

