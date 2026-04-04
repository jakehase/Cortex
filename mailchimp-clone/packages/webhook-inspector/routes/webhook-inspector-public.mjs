import { buildWebhookInspectorSnapshot } from '../service-webhook-inspector.mjs';
import { createWebhookInspectorFixtures } from '../fixtures-webhook-inspector.mjs';

export function createWebhookInspectorPublicRoutes(basePath = '/public/webhook-inspector') { const snapshot = buildWebhookInspectorSnapshot(); const fixtures = createWebhookInspectorFixtures(); return [{ id: 'webhook-inspector.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'webhook-inspector.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'webhook-inspector.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

