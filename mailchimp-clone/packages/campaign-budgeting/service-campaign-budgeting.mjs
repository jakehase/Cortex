import { createCampaignBudgetingWorkspace, summarizeCampaignBudgeting, createCampaignBudgetingNarratives } from './domain-campaign-budgeting.mjs';
import { createCampaignBudgetingPolicies, validateCampaignBudgetingPolicies, policySummaryCampaignBudgeting } from './domain-campaign-budgeting-policies.mjs';

export function buildCampaignBudgetingSnapshot(workspaceName = 'Continuation workspace') {
  const workspace = createCampaignBudgetingWorkspace(workspaceName);
  const policies = createCampaignBudgetingPolicies();
  return { workspace, summary: summarizeCampaignBudgeting(workspace), narratives: createCampaignBudgetingNarratives(workspace), policies, policySummary: policySummaryCampaignBudgeting(policies), validation: validateCampaignBudgetingPolicies(policies) };
}

export function createCampaignBudgetingChecklist(snapshot = buildCampaignBudgetingSnapshot()) {
  return [
    { id: 'campaign-budgeting-check-1', label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: 'campaign-budgeting-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'campaign-budgeting-check-3', label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createCampaignBudgetingApiDocument(snapshot = buildCampaignBudgetingSnapshot()) {
  return { id: 'campaign-budgeting-api', headline: snapshot.summary.name + ' API contract', endpoints: [{ method: 'GET', path: '/api/campaign-budgeting/overview' }, { method: 'POST', path: '/api/campaign-budgeting/validate' }, { method: 'GET', path: '/api/campaign-budgeting/policies' }], checklist: createCampaignBudgetingChecklist(snapshot) };
}
