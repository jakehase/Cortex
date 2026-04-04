import { createWebhookInspectorWorkspace, summarizeWebhookInspector, createWebhookInspectorNarratives } from './domain-webhook-inspector.mjs';
import { createWebhookInspectorPolicies, validateWebhookInspectorPolicies, policySummaryWebhookInspector } from './domain-webhook-inspector-policies.mjs';

export function buildWebhookInspectorSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createWebhookInspectorWorkspace(workspaceName);
  const policies = createWebhookInspectorPolicies();
  return { workspace, summary: summarizeWebhookInspector(workspace), narratives: createWebhookInspectorNarratives(workspace), policies, policySummary: policySummaryWebhookInspector(policies), validation: validateWebhookInspectorPolicies(policies) };
}

export function createWebhookInspectorChecklist(snapshot = buildWebhookInspectorSnapshot()) {
  return [
    { id: "webhook-inspector-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "webhook-inspector-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "webhook-inspector-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createWebhookInspectorApiDocument(snapshot = buildWebhookInspectorSnapshot()) {
  return {
    id: "webhook-inspector-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/webhook-inspector/overview' },
      { method: 'POST', path: '/api/webhook-inspector/validate' },
      { method: 'GET', path: '/api/webhook-inspector/policies' }
    ],
    checklist: createWebhookInspectorChecklist(snapshot)
  };
}

