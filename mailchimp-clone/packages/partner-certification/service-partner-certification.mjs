import { createPartnerCertificationWorkspace, summarizePartnerCertification, createPartnerCertificationNarratives } from './domain-partner-certification.mjs';
import { createPartnerCertificationPolicies, validatePartnerCertificationPolicies, policySummaryPartnerCertification } from './domain-partner-certification-policies.mjs';

export function buildPartnerCertificationSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createPartnerCertificationWorkspace(workspaceName);
  const policies = createPartnerCertificationPolicies();
  return { workspace, summary: summarizePartnerCertification(workspace), narratives: createPartnerCertificationNarratives(workspace), policies, policySummary: policySummaryPartnerCertification(policies), validation: validatePartnerCertificationPolicies(policies) };
}

export function createPartnerCertificationChecklist(snapshot = buildPartnerCertificationSnapshot()) {
  return [
    { id: "partner-certification-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "partner-certification-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "partner-certification-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createPartnerCertificationApiDocument(snapshot = buildPartnerCertificationSnapshot()) {
  return {
    id: "partner-certification-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/partner-certification/overview' },
      { method: 'POST', path: '/api/partner-certification/validate' },
      { method: 'GET', path: '/api/partner-certification/policies' }
    ],
    checklist: createPartnerCertificationChecklist(snapshot)
  };
}

