import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationVaultSnapshot, createExperimentationVaultDashboardRoutes, createExperimentationVaultApiRoutes, createExperimentationVaultOpsRoutes, createExperimentationVaultPublicRoutes, createExperimentationVaultRegistryRoutes, summarizeExperimentationVaultFixtures } from '../packages/experimentation-vault/index.mjs';

test('experimentation-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationVaultDashboardRoutes().length, 3);
  assert.equal(createExperimentationVaultApiRoutes().length, 4);
  assert.equal(createExperimentationVaultOpsRoutes().length, 3);
  assert.equal(createExperimentationVaultPublicRoutes().length, 3);
  assert.equal(createExperimentationVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationVaultFixtures().contacts, 2);
});

