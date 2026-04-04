import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkDossierSnapshot, createBenchmarkDossierDashboardRoutes, createBenchmarkDossierApiRoutes, createBenchmarkDossierOpsRoutes, createBenchmarkDossierPublicRoutes, createBenchmarkDossierRegistryRoutes, summarizeBenchmarkDossierFixtures } from '../packages/benchmark-dossier/index.mjs';

test('benchmark-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkDossierDashboardRoutes().length, 3);
  assert.equal(createBenchmarkDossierApiRoutes().length, 4);
  assert.equal(createBenchmarkDossierOpsRoutes().length, 3);
  assert.equal(createBenchmarkDossierPublicRoutes().length, 3);
  assert.equal(createBenchmarkDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkDossierFixtures().contacts, 2);
});

