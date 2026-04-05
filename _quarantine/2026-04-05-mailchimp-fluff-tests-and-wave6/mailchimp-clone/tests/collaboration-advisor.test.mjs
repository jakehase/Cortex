import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationAdvisorSnapshot, createCollaborationAdvisorDashboardRoutes, createCollaborationAdvisorApiRoutes, createCollaborationAdvisorOpsRoutes, createCollaborationAdvisorPublicRoutes, createCollaborationAdvisorRegistryRoutes, summarizeCollaborationAdvisorFixtures } from '../packages/collaboration-advisor/index.mjs';

test('collaboration-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationAdvisorDashboardRoutes().length, 3);
  assert.equal(createCollaborationAdvisorApiRoutes().length, 4);
  assert.equal(createCollaborationAdvisorOpsRoutes().length, 3);
  assert.equal(createCollaborationAdvisorPublicRoutes().length, 3);
  assert.equal(createCollaborationAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationAdvisorFixtures().contacts, 2);
});

