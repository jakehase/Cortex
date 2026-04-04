import { createAgencyWorkspaceWorkspace, summarizeAgencyWorkspace, createAgencyWorkspaceNarratives } from './domain-agency-workspace.mjs';
import { createAgencyWorkspacePolicies, validateAgencyWorkspacePolicies, policySummaryAgencyWorkspace } from './domain-agency-workspace-policies.mjs';

export function buildAgencyWorkspaceSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createAgencyWorkspaceWorkspace(workspaceName);
  const policies = createAgencyWorkspacePolicies();
  return {
    workspace,
    summary: summarizeAgencyWorkspace(workspace),
    narratives: createAgencyWorkspaceNarratives(workspace),
    policies,
    policySummary: policySummaryAgencyWorkspace(policies),
    validation: validateAgencyWorkspacePolicies(policies)
  };
}

export function createAgencyWorkspaceChecklist(snapshot = buildAgencyWorkspaceSnapshot()) {
  return [
    { id: 'agency-workspace-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'agency-workspace-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'agency-workspace-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createAgencyWorkspaceApiDocument(snapshot = buildAgencyWorkspaceSnapshot()) {
  return {
    id: 'agency-workspace-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/agency-workspace/overview' },
      { method: 'POST', path: '/api/agency-workspace/validate' },
      { method: 'GET', path: '/api/agency-workspace/policies' }
    ],
    checklist: createAgencyWorkspaceChecklist(snapshot)
  };
}
