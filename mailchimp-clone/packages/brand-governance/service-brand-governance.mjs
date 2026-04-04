import { createBrandGovernanceWorkspace, summarizeBrandGovernance, createBrandGovernanceNarratives } from './domain-brand-governance.mjs';
import { createBrandGovernancePolicies, validateBrandGovernancePolicies, policySummaryBrandGovernance } from './domain-brand-governance-policies.mjs';

export function buildBrandGovernanceSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createBrandGovernanceWorkspace(workspaceName);
  const policies = createBrandGovernancePolicies();
  return {
    workspace,
    summary: summarizeBrandGovernance(workspace),
    narratives: createBrandGovernanceNarratives(workspace),
    policies,
    policySummary: policySummaryBrandGovernance(policies),
    validation: validateBrandGovernancePolicies(policies)
  };
}

export function createBrandGovernanceChecklist(snapshot = buildBrandGovernanceSnapshot()) {
  return [
    { id: 'brand-governance-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'brand-governance-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'brand-governance-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createBrandGovernanceApiDocument(snapshot = buildBrandGovernanceSnapshot()) {
  return {
    id: 'brand-governance-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/brand-governance/overview' },
      { method: 'POST', path: '/api/brand-governance/validate' },
      { method: 'GET', path: '/api/brand-governance/policies' }
    ],
    checklist: createBrandGovernanceChecklist(snapshot)
  };
}
