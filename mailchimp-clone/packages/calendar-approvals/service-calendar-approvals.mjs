import { createCalendarApprovalsWorkspace, summarizeCalendarApprovals, createCalendarApprovalsNarratives } from './domain-calendar-approvals.mjs';
import { createCalendarApprovalsPolicies, validateCalendarApprovalsPolicies, policySummaryCalendarApprovals } from './domain-calendar-approvals-policies.mjs';

export function buildCalendarApprovalsSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createCalendarApprovalsWorkspace(workspaceName);
  const policies = createCalendarApprovalsPolicies();
  return { workspace, summary: summarizeCalendarApprovals(workspace), narratives: createCalendarApprovalsNarratives(workspace), policies, policySummary: policySummaryCalendarApprovals(policies), validation: validateCalendarApprovalsPolicies(policies) };
}

export function createCalendarApprovalsChecklist(snapshot = buildCalendarApprovalsSnapshot()) {
  return [
    { id: "calendar-approvals-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "calendar-approvals-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "calendar-approvals-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createCalendarApprovalsApiDocument(snapshot = buildCalendarApprovalsSnapshot()) {
  return {
    id: "calendar-approvals-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/calendar-approvals/overview' },
      { method: 'POST', path: '/api/calendar-approvals/validate' },
      { method: 'GET', path: '/api/calendar-approvals/policies' }
    ],
    checklist: createCalendarApprovalsChecklist(snapshot)
  };
}

