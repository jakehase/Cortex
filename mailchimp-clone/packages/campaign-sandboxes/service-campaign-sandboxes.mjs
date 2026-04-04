import { createCampaignSandboxesWorkspace, summarizeCampaignSandboxes, createCampaignSandboxesNarratives } from './domain-campaign-sandboxes.mjs';
import { createCampaignSandboxesPolicies, validateCampaignSandboxesPolicies, policySummaryCampaignSandboxes } from './domain-campaign-sandboxes-policies.mjs';

export function buildCampaignSandboxesSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createCampaignSandboxesWorkspace(workspaceName);
  const policies = createCampaignSandboxesPolicies();
  return { workspace, summary: summarizeCampaignSandboxes(workspace), narratives: createCampaignSandboxesNarratives(workspace), policies, policySummary: policySummaryCampaignSandboxes(policies), validation: validateCampaignSandboxesPolicies(policies) };
}

export function createCampaignSandboxesChecklist(snapshot = buildCampaignSandboxesSnapshot()) {
  return [
    { id: "campaign-sandboxes-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "campaign-sandboxes-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "campaign-sandboxes-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createCampaignSandboxesApiDocument(snapshot = buildCampaignSandboxesSnapshot()) {
  return {
    id: "campaign-sandboxes-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/campaign-sandboxes/overview' },
      { method: 'POST', path: '/api/campaign-sandboxes/validate' },
      { method: 'GET', path: '/api/campaign-sandboxes/policies' }
    ],
    checklist: createCampaignSandboxesChecklist(snapshot)
  };
}

