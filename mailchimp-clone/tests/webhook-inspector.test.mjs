import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebhookInspectorSnapshot, createWebhookInspectorDashboardRoutes, createWebhookInspectorApiRoutes, createWebhookInspectorOpsRoutes, createWebhookInspectorPublicRoutes, summarizeWebhookInspectorFixtures } from '../packages/webhook-inspector/index.mjs';

test('webhook-inspector package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildWebhookInspectorSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createWebhookInspectorDashboardRoutes().length, 3);
  assert.equal(createWebhookInspectorApiRoutes().length, 3);
  assert.equal(createWebhookInspectorOpsRoutes().length, 3);
  assert.equal(createWebhookInspectorPublicRoutes().length, 3);
  assert.equal(summarizeWebhookInspectorFixtures().contacts, 2);
});

