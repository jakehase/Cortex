import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationExchangeSnapshot, createCollaborationExchangeDashboardRoutes, createCollaborationExchangeApiRoutes, createCollaborationExchangeOpsRoutes, createCollaborationExchangePublicRoutes, createCollaborationExchangeRegistryRoutes, summarizeCollaborationExchangeFixtures } from '../packages/collaboration-exchange/index.mjs';

test('collaboration-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationExchangeDashboardRoutes().length, 3);
  assert.equal(createCollaborationExchangeApiRoutes().length, 4);
  assert.equal(createCollaborationExchangeOpsRoutes().length, 3);
  assert.equal(createCollaborationExchangePublicRoutes().length, 3);
  assert.equal(createCollaborationExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationExchangeFixtures().contacts, 2);
});

