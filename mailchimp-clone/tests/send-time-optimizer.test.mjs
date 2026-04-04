import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSendTimeOptimizerSnapshot, createSendTimeOptimizerDashboardRoutes, createSendTimeOptimizerApiRoutes, createSendTimeOptimizerOpsRoutes, createSendTimeOptimizerPublicRoutes, summarizeSendTimeOptimizerFixtures } from '../packages/send-time-optimizer/index.mjs';

test('send-time-optimizer package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildSendTimeOptimizerSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createSendTimeOptimizerDashboardRoutes().length, 3);
  assert.equal(createSendTimeOptimizerApiRoutes().length, 3);
  assert.equal(createSendTimeOptimizerOpsRoutes().length, 3);
  assert.equal(createSendTimeOptimizerPublicRoutes().length, 3);
  assert.equal(summarizeSendTimeOptimizerFixtures().contacts, 2);
});
