import { buildWebhookInspectorSnapshot, createWebhookInspectorApiDocument } from '../service-webhook-inspector.mjs';

export function createWebhookInspectorApiRoutes(basePath = '/api/webhook-inspector') { const snapshot = buildWebhookInspectorSnapshot(); return [{ id: 'webhook-inspector.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'webhook-inspector.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'webhook-inspector.api.document', method: 'GET', path: basePath + '/document', document: createWebhookInspectorApiDocument(snapshot) }]; }

