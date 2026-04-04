import { createTemplateApprovalsWorkspace, summarizeTemplateApprovals, createTemplateApprovalsNarratives } from './domain-template-approvals.mjs';
import { createTemplateApprovalsPolicies, validateTemplateApprovalsPolicies, policySummaryTemplateApprovals } from './domain-template-approvals-policies.mjs';

export function buildTemplateApprovalsSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createTemplateApprovalsWorkspace(workspaceName);
  const policies = createTemplateApprovalsPolicies();
  return { workspace, summary: summarizeTemplateApprovals(workspace), narratives: createTemplateApprovalsNarratives(workspace), policies, policySummary: policySummaryTemplateApprovals(policies), validation: validateTemplateApprovalsPolicies(policies) };
}

export function createTemplateApprovalsChecklist(snapshot = buildTemplateApprovalsSnapshot()) {
  return [
    { id: "template-approvals-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "template-approvals-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "template-approvals-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createTemplateApprovalsApiDocument(snapshot = buildTemplateApprovalsSnapshot()) {
  return {
    id: "template-approvals-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/template-approvals/overview' },
      { method: 'POST', path: '/api/template-approvals/validate' },
      { method: 'GET', path: '/api/template-approvals/policies' }
    ],
    checklist: createTemplateApprovalsChecklist(snapshot)
  };
}

