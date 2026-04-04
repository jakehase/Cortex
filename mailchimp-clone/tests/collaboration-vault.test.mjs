import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationVaultSnapshot, createCollaborationVaultDashboardRoutes, createCollaborationVaultApiRoutes, createCollaborationVaultOpsRoutes, createCollaborationVaultPublicRoutes, createCollaborationVaultRegistryRoutes, summarizeCollaborationVaultFixtures } from '../packages/collaboration-vault/index.mjs';

test('collaboration-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationVaultDashboardRoutes().length, 3);
  assert.equal(createCollaborationVaultApiRoutes().length, 4);
  assert.equal(createCollaborationVaultOpsRoutes().length, 3);
  assert.equal(createCollaborationVaultPublicRoutes().length, 3);
  assert.equal(createCollaborationVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationVaultFixtures().contacts, 2);
});

