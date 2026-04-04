import { createCreativeBriefBuilderWorkspace, summarizeCreativeBriefBuilder, createCreativeBriefBuilderNarratives } from './domain-creative-brief-builder.mjs';
import { createCreativeBriefBuilderPolicies, validateCreativeBriefBuilderPolicies, policySummaryCreativeBriefBuilder } from './domain-creative-brief-builder-policies.mjs';

export function buildCreativeBriefBuilderSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createCreativeBriefBuilderWorkspace(workspaceName);
  const policies = createCreativeBriefBuilderPolicies();
  return { workspace, summary: summarizeCreativeBriefBuilder(workspace), narratives: createCreativeBriefBuilderNarratives(workspace), policies, policySummary: policySummaryCreativeBriefBuilder(policies), validation: validateCreativeBriefBuilderPolicies(policies) };
}

export function createCreativeBriefBuilderChecklist(snapshot = buildCreativeBriefBuilderSnapshot()) {
  return [
    { id: "creative-brief-builder-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "creative-brief-builder-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "creative-brief-builder-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createCreativeBriefBuilderApiDocument(snapshot = buildCreativeBriefBuilderSnapshot()) {
  return {
    id: "creative-brief-builder-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/creative-brief-builder/overview' },
      { method: 'POST', path: '/api/creative-brief-builder/validate' },
      { method: 'GET', path: '/api/creative-brief-builder/policies' }
    ],
    checklist: createCreativeBriefBuilderChecklist(snapshot)
  };
}

