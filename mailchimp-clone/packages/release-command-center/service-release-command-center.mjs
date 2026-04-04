import { createReleaseCommandCenterWorkspace, summarizeReleaseCommandCenter, createReleaseCommandCenterNarratives } from './domain-release-command-center.mjs';
import { createReleaseCommandCenterPolicies, validateReleaseCommandCenterPolicies, policySummaryReleaseCommandCenter } from './domain-release-command-center-policies.mjs';

export function buildReleaseCommandCenterSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createReleaseCommandCenterWorkspace(workspaceName);
  const policies = createReleaseCommandCenterPolicies();
  return { workspace, summary: summarizeReleaseCommandCenter(workspace), narratives: createReleaseCommandCenterNarratives(workspace), policies, policySummary: policySummaryReleaseCommandCenter(policies), validation: validateReleaseCommandCenterPolicies(policies) };
}

export function createReleaseCommandCenterChecklist(snapshot = buildReleaseCommandCenterSnapshot()) {
  return [
    { id: "release-command-center-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "release-command-center-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "release-command-center-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createReleaseCommandCenterApiDocument(snapshot = buildReleaseCommandCenterSnapshot()) {
  return {
    id: "release-command-center-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/release-command-center/overview' },
      { method: 'POST', path: '/api/release-command-center/validate' },
      { method: 'GET', path: '/api/release-command-center/policies' }
    ],
    checklist: createReleaseCommandCenterChecklist(snapshot)
  };
}

