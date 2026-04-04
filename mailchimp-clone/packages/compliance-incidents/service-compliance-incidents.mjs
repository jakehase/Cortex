import { createComplianceIncidentsWorkspace, summarizeComplianceIncidents, createComplianceIncidentsNarratives } from './domain-compliance-incidents.mjs';
import { createComplianceIncidentsPolicies, validateComplianceIncidentsPolicies, policySummaryComplianceIncidents } from './domain-compliance-incidents-policies.mjs';

export function buildComplianceIncidentsSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createComplianceIncidentsWorkspace(workspaceName);
  const policies = createComplianceIncidentsPolicies();
  return { workspace, summary: summarizeComplianceIncidents(workspace), narratives: createComplianceIncidentsNarratives(workspace), policies, policySummary: policySummaryComplianceIncidents(policies), validation: validateComplianceIncidentsPolicies(policies) };
}

export function createComplianceIncidentsChecklist(snapshot = buildComplianceIncidentsSnapshot()) {
  return [
    { id: "compliance-incidents-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "compliance-incidents-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "compliance-incidents-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createComplianceIncidentsApiDocument(snapshot = buildComplianceIncidentsSnapshot()) {
  return {
    id: "compliance-incidents-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/compliance-incidents/overview' },
      { method: 'POST', path: '/api/compliance-incidents/validate' },
      { method: 'GET', path: '/api/compliance-incidents/policies' }
    ],
    checklist: createComplianceIncidentsChecklist(snapshot)
  };
}

