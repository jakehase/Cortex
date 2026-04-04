import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSmsOrchestrationSnapshot, createSmsOrchestrationDashboardRoutes, createSmsOrchestrationApiRoutes, createSmsOrchestrationOpsRoutes, createSmsOrchestrationPublicRoutes, summarizeSmsOrchestrationFixtures } from '../packages/sms-orchestration/index.mjs';

test('sms-orchestration package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildSmsOrchestrationSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createSmsOrchestrationDashboardRoutes().length, 3);
  assert.equal(createSmsOrchestrationApiRoutes().length, 3);
  assert.equal(createSmsOrchestrationOpsRoutes().length, 3);
  assert.equal(createSmsOrchestrationPublicRoutes().length, 3);
  assert.equal(summarizeSmsOrchestrationFixtures().contacts, 2);
});
