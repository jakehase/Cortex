import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationLedgerSnapshot, createCollaborationLedgerDashboardRoutes, createCollaborationLedgerApiRoutes, createCollaborationLedgerOpsRoutes, createCollaborationLedgerPublicRoutes, createCollaborationLedgerRegistryRoutes, summarizeCollaborationLedgerFixtures } from '../packages/collaboration-ledger/index.mjs';

test('collaboration-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationLedgerDashboardRoutes().length, 3);
  assert.equal(createCollaborationLedgerApiRoutes().length, 4);
  assert.equal(createCollaborationLedgerOpsRoutes().length, 3);
  assert.equal(createCollaborationLedgerPublicRoutes().length, 3);
  assert.equal(createCollaborationLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationLedgerFixtures().contacts, 2);
});

