import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebhookInspectorDashboardRoutes, createWebhookInspectorApiRoutes, createWebhookInspectorOpsRoutes, createWebhookInspectorPublicRoutes } from '../packages/webhook-inspector/index.mjs';

test('webhook-inspector routes honor custom base paths and stable ids', () => {
  const dashboard = createWebhookInspectorDashboardRoutes('/labs/webhook-inspector');
  const api = createWebhookInspectorApiRoutes('/api/labs/webhook-inspector');
  const ops = createWebhookInspectorOpsRoutes('/ops/labs/webhook-inspector');
  const pub = createWebhookInspectorPublicRoutes('/public/labs/webhook-inspector');
  assert.equal(dashboard[0].path, '/labs/webhook-inspector');
  assert.equal(api[0].path, '/api/labs/webhook-inspector/overview');
  assert.equal(ops[0].path, '/ops/labs/webhook-inspector/health');
  assert.equal(pub[0].path, '/public/labs/webhook-inspector');
  assert.match(dashboard[0].id, /webhook\-inspector/);
  assert.match(api[2].id, /webhook\-inspector/);
});

