import { createReferralEngineWorkspace, summarizeReferralEngine, createReferralEngineNarratives } from './domain-referral-engine.mjs';
import { createReferralEnginePolicies, validateReferralEnginePolicies, policySummaryReferralEngine } from './domain-referral-engine-policies.mjs';

export function buildReferralEngineSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createReferralEngineWorkspace(workspaceName);
  const policies = createReferralEnginePolicies();
  return {
    workspace,
    summary: summarizeReferralEngine(workspace),
    narratives: createReferralEngineNarratives(workspace),
    policies,
    policySummary: policySummaryReferralEngine(policies),
    validation: validateReferralEnginePolicies(policies)
  };
}

export function createReferralEngineChecklist(snapshot = buildReferralEngineSnapshot()) {
  return [
    { id: 'referral-engine-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'referral-engine-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'referral-engine-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createReferralEngineApiDocument(snapshot = buildReferralEngineSnapshot()) {
  return {
    id: 'referral-engine-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/referral-engine/overview' },
      { method: 'POST', path: '/api/referral-engine/validate' },
      { method: 'GET', path: '/api/referral-engine/policies' }
    ],
    checklist: createReferralEngineChecklist(snapshot)
  };
}
