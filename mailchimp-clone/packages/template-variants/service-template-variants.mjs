import { createTemplateVariantsWorkspace, summarizeTemplateVariants, createTemplateVariantsNarratives } from './domain-template-variants.mjs';
import { createTemplateVariantsPolicies, validateTemplateVariantsPolicies, policySummaryTemplateVariants } from './domain-template-variants-policies.mjs';

export function buildTemplateVariantsSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createTemplateVariantsWorkspace(workspaceName);
  const policies = createTemplateVariantsPolicies();
  return { workspace, summary: summarizeTemplateVariants(workspace), narratives: createTemplateVariantsNarratives(workspace), policies, policySummary: policySummaryTemplateVariants(policies), validation: validateTemplateVariantsPolicies(policies) };
}

export function createTemplateVariantsChecklist(snapshot = buildTemplateVariantsSnapshot()) {
  return [
    { id: "template-variants-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "template-variants-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "template-variants-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createTemplateVariantsApiDocument(snapshot = buildTemplateVariantsSnapshot()) {
  return {
    id: "template-variants-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/template-variants/overview' },
      { method: 'POST', path: '/api/template-variants/validate' },
      { method: 'GET', path: '/api/template-variants/policies' }
    ],
    checklist: createTemplateVariantsChecklist(snapshot)
  };
}

