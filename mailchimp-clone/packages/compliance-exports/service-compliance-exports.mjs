import { createComplianceExportsWorkspace, summarizeComplianceExports, createComplianceExportsNarratives } from './domain-compliance-exports.mjs';
import { createComplianceExportsPolicies, validateComplianceExportsPolicies, policySummaryComplianceExports } from './domain-compliance-exports-policies.mjs';

export function buildComplianceExportsSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createComplianceExportsWorkspace(workspaceName);
  const policies = createComplianceExportsPolicies();
  return {
    workspace,
    summary: summarizeComplianceExports(workspace),
    narratives: createComplianceExportsNarratives(workspace),
    policies,
    policySummary: policySummaryComplianceExports(policies),
    validation: validateComplianceExportsPolicies(policies)
  };
}

export function createComplianceExportsChecklist(snapshot = buildComplianceExportsSnapshot()) {
  return [
    { id: 'compliance-exports-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'compliance-exports-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'compliance-exports-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createComplianceExportsApiDocument(snapshot = buildComplianceExportsSnapshot()) {
  return {
    id: 'compliance-exports-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/compliance-exports/overview' },
      { method: 'POST', path: '/api/compliance-exports/validate' },
      { method: 'GET', path: '/api/compliance-exports/policies' }
    ],
    checklist: createComplianceExportsChecklist(snapshot)
  };
}
