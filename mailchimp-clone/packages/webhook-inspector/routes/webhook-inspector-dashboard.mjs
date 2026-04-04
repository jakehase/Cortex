import { buildWebhookInspectorSnapshot } from '../service-webhook-inspector.mjs';

export function createWebhookInspectorDashboardRoutes(basePath = '/webhook-inspector') { const snapshot = buildWebhookInspectorSnapshot(); return [{ id: 'webhook-inspector.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'webhook-inspector.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'webhook-inspector.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

