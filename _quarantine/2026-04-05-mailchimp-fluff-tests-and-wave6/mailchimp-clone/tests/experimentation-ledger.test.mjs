import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationLedgerSnapshot, createExperimentationLedgerDashboardRoutes, createExperimentationLedgerApiRoutes, createExperimentationLedgerOpsRoutes, createExperimentationLedgerPublicRoutes, createExperimentationLedgerRegistryRoutes, summarizeExperimentationLedgerFixtures } from '../packages/experimentation-ledger/index.mjs';

test('experimentation-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationLedgerDashboardRoutes().length, 3);
  assert.equal(createExperimentationLedgerApiRoutes().length, 4);
  assert.equal(createExperimentationLedgerOpsRoutes().length, 3);
  assert.equal(createExperimentationLedgerPublicRoutes().length, 3);
  assert.equal(createExperimentationLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationLedgerFixtures().contacts, 2);
});

