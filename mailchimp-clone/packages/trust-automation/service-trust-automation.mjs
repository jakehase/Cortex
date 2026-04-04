import { createTrustAutomationWorkspace, summarizeTrustAutomation, createTrustAutomationNarratives } from './domain-trust-automation.mjs';
import { createTrustAutomationPolicies, validateTrustAutomationPolicies, policySummaryTrustAutomation } from './domain-trust-automation-policies.mjs';

export function buildTrustAutomationSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createTrustAutomationWorkspace(workspaceName);
  const policies = createTrustAutomationPolicies();
  return { workspace, summary: summarizeTrustAutomation(workspace), narratives: createTrustAutomationNarratives(workspace), policies, policySummary: policySummaryTrustAutomation(policies), validation: validateTrustAutomationPolicies(policies) };
}

export function createTrustAutomationChecklist(snapshot = buildTrustAutomationSnapshot()) {
  return [
    { id: "trust-automation-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "trust-automation-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "trust-automation-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createTrustAutomationApiDocument(snapshot = buildTrustAutomationSnapshot()) {
  return {
    id: "trust-automation-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/trust-automation/overview' },
      { method: 'POST', path: '/api/trust-automation/validate' },
      { method: 'GET', path: '/api/trust-automation/policies' }
    ],
    checklist: createTrustAutomationChecklist(snapshot)
  };
}

