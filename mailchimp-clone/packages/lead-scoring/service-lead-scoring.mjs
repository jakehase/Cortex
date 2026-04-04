import { createLeadScoringWorkspace, summarizeLeadScoring, createLeadScoringNarratives } from './domain-lead-scoring.mjs';
import { createLeadScoringPolicies, validateLeadScoringPolicies, policySummaryLeadScoring } from './domain-lead-scoring-policies.mjs';

export function buildLeadScoringSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createLeadScoringWorkspace(workspaceName);
  const policies = createLeadScoringPolicies();
  return {
    workspace,
    summary: summarizeLeadScoring(workspace),
    narratives: createLeadScoringNarratives(workspace),
    policies,
    policySummary: policySummaryLeadScoring(policies),
    validation: validateLeadScoringPolicies(policies)
  };
}

export function createLeadScoringChecklist(snapshot = buildLeadScoringSnapshot()) {
  return [
    { id: 'lead-scoring-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'lead-scoring-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'lead-scoring-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createLeadScoringApiDocument(snapshot = buildLeadScoringSnapshot()) {
  return {
    id: 'lead-scoring-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/lead-scoring/overview' },
      { method: 'POST', path: '/api/lead-scoring/validate' },
      { method: 'GET', path: '/api/lead-scoring/policies' }
    ],
    checklist: createLeadScoringChecklist(snapshot)
  };
}
