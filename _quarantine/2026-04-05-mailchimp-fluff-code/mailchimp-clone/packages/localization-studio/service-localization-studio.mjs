import { createLocalizationStudioWorkspace, summarizeLocalizationStudio, createLocalizationStudioNarratives } from './domain-localization-studio.mjs';
import { createLocalizationStudioPolicies, validateLocalizationStudioPolicies, policySummaryLocalizationStudio } from './domain-localization-studio-policies.mjs';

export function buildLocalizationStudioSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createLocalizationStudioWorkspace(workspaceName);
  const policies = createLocalizationStudioPolicies();
  return {
    workspace,
    summary: summarizeLocalizationStudio(workspace),
    narratives: createLocalizationStudioNarratives(workspace),
    policies,
    policySummary: policySummaryLocalizationStudio(policies),
    validation: validateLocalizationStudioPolicies(policies)
  };
}

export function createLocalizationStudioChecklist(snapshot = buildLocalizationStudioSnapshot()) {
  return [
    { id: 'localization-studio-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'localization-studio-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'localization-studio-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createLocalizationStudioApiDocument(snapshot = buildLocalizationStudioSnapshot()) {
  return {
    id: 'localization-studio-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/localization-studio/overview' },
      { method: 'POST', path: '/api/localization-studio/validate' },
      { method: 'GET', path: '/api/localization-studio/policies' }
    ],
    checklist: createLocalizationStudioChecklist(snapshot)
  };
}
