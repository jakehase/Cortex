import { buildWebhookInspectorSnapshot, createWebhookInspectorChecklist } from '../service-webhook-inspector.mjs';

export function createWebhookInspectorOpsRoutes(basePath = '/ops/webhook-inspector') { const snapshot = buildWebhookInspectorSnapshot(); return [{ id: 'webhook-inspector.ops.health', method: 'GET', path: basePath + '/health', checklist: createWebhookInspectorChecklist(snapshot) }, { id: 'webhook-inspector.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'webhook-inspector.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

