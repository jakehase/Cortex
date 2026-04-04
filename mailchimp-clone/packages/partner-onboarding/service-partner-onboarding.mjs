import { createPartnerOnboardingWorkspace, summarizePartnerOnboarding, createPartnerOnboardingNarratives } from './domain-partner-onboarding.mjs';
import { createPartnerOnboardingPolicies, validatePartnerOnboardingPolicies, policySummaryPartnerOnboarding } from './domain-partner-onboarding-policies.mjs';

export function buildPartnerOnboardingSnapshot(workspaceName = 'Continuation workspace') {
  const workspace = createPartnerOnboardingWorkspace(workspaceName);
  const policies = createPartnerOnboardingPolicies();
  return { workspace, summary: summarizePartnerOnboarding(workspace), narratives: createPartnerOnboardingNarratives(workspace), policies, policySummary: policySummaryPartnerOnboarding(policies), validation: validatePartnerOnboardingPolicies(policies) };
}

export function createPartnerOnboardingChecklist(snapshot = buildPartnerOnboardingSnapshot()) {
  return [
    { id: 'partner-onboarding-check-1', label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: 'partner-onboarding-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'partner-onboarding-check-3', label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createPartnerOnboardingApiDocument(snapshot = buildPartnerOnboardingSnapshot()) {
  return { id: 'partner-onboarding-api', headline: snapshot.summary.name + ' API contract', endpoints: [{ method: 'GET', path: '/api/partner-onboarding/overview' }, { method: 'POST', path: '/api/partner-onboarding/validate' }, { method: 'GET', path: '/api/partner-onboarding/policies' }], checklist: createPartnerOnboardingChecklist(snapshot) };
}
