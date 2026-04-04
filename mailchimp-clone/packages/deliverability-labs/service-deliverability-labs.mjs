import { createDeliverabilityLabsWorkspace, summarizeDeliverabilityLabs, createDeliverabilityLabsNarratives } from './domain-deliverability-labs.mjs';
import { createDeliverabilityLabsPolicies, validateDeliverabilityLabsPolicies, policySummaryDeliverabilityLabs } from './domain-deliverability-labs-policies.mjs';

export function buildDeliverabilityLabsSnapshot(workspaceName = 'Continuation workspace') {
  const workspace = createDeliverabilityLabsWorkspace(workspaceName);
  const policies = createDeliverabilityLabsPolicies();
  return { workspace, summary: summarizeDeliverabilityLabs(workspace), narratives: createDeliverabilityLabsNarratives(workspace), policies, policySummary: policySummaryDeliverabilityLabs(policies), validation: validateDeliverabilityLabsPolicies(policies) };
}

export function createDeliverabilityLabsChecklist(snapshot = buildDeliverabilityLabsSnapshot()) {
  return [
    { id: 'deliverability-labs-check-1', label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: 'deliverability-labs-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'deliverability-labs-check-3', label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createDeliverabilityLabsApiDocument(snapshot = buildDeliverabilityLabsSnapshot()) {
  return { id: 'deliverability-labs-api', headline: snapshot.summary.name + ' API contract', endpoints: [{ method: 'GET', path: '/api/deliverability-labs/overview' }, { method: 'POST', path: '/api/deliverability-labs/validate' }, { method: 'GET', path: '/api/deliverability-labs/policies' }], checklist: createDeliverabilityLabsChecklist(snapshot) };
}
