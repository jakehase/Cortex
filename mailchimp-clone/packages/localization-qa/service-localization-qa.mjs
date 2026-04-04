import { createLocalizationQaWorkspace, summarizeLocalizationQa, createLocalizationQaNarratives } from './domain-localization-qa.mjs';
import { createLocalizationQaPolicies, validateLocalizationQaPolicies, policySummaryLocalizationQa } from './domain-localization-qa-policies.mjs';

export function buildLocalizationQaSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createLocalizationQaWorkspace(workspaceName);
  const policies = createLocalizationQaPolicies();
  return { workspace, summary: summarizeLocalizationQa(workspace), narratives: createLocalizationQaNarratives(workspace), policies, policySummary: policySummaryLocalizationQa(policies), validation: validateLocalizationQaPolicies(policies) };
}

export function createLocalizationQaChecklist(snapshot = buildLocalizationQaSnapshot()) {
  return [
    { id: "localization-qa-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "localization-qa-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "localization-qa-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createLocalizationQaApiDocument(snapshot = buildLocalizationQaSnapshot()) {
  return {
    id: "localization-qa-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/localization-qa/overview' },
      { method: 'POST', path: '/api/localization-qa/validate' },
      { method: 'GET', path: '/api/localization-qa/policies' }
    ],
    checklist: createLocalizationQaChecklist(snapshot)
  };
}

