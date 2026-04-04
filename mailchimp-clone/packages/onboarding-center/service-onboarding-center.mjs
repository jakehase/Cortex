import { createOnboardingCenterWorkspace, summarizeOnboardingCenter, createOnboardingCenterNarratives } from './domain-onboarding-center.mjs';
import { createOnboardingCenterPolicies, validateOnboardingCenterPolicies, policySummaryOnboardingCenter } from './domain-onboarding-center-policies.mjs';

export function buildOnboardingCenterSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createOnboardingCenterWorkspace(workspaceName);
  const policies = createOnboardingCenterPolicies();
  return {
    workspace,
    summary: summarizeOnboardingCenter(workspace),
    narratives: createOnboardingCenterNarratives(workspace),
    policies,
    policySummary: policySummaryOnboardingCenter(policies),
    validation: validateOnboardingCenterPolicies(policies)
  };
}

export function createOnboardingCenterChecklist(snapshot = buildOnboardingCenterSnapshot()) {
  return [
    { id: 'onboarding-center-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'onboarding-center-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'onboarding-center-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createOnboardingCenterApiDocument(snapshot = buildOnboardingCenterSnapshot()) {
  return {
    id: 'onboarding-center-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/onboarding-center/overview' },
      { method: 'POST', path: '/api/onboarding-center/validate' },
      { method: 'GET', path: '/api/onboarding-center/policies' }
    ],
    checklist: createOnboardingCenterChecklist(snapshot)
  };
}
