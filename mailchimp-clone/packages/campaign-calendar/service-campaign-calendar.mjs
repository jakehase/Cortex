import { createCampaignCalendarWorkspace, summarizeCampaignCalendar, createCampaignCalendarNarratives } from './domain-campaign-calendar.mjs';
import { createCampaignCalendarPolicies, validateCampaignCalendarPolicies, policySummaryCampaignCalendar } from './domain-campaign-calendar-policies.mjs';

export function buildCampaignCalendarSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createCampaignCalendarWorkspace(workspaceName);
  const policies = createCampaignCalendarPolicies();
  return {
    workspace,
    summary: summarizeCampaignCalendar(workspace),
    narratives: createCampaignCalendarNarratives(workspace),
    policies,
    policySummary: policySummaryCampaignCalendar(policies),
    validation: validateCampaignCalendarPolicies(policies)
  };
}

export function createCampaignCalendarChecklist(snapshot = buildCampaignCalendarSnapshot()) {
  return [
    { id: 'campaign-calendar-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'campaign-calendar-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'campaign-calendar-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createCampaignCalendarApiDocument(snapshot = buildCampaignCalendarSnapshot()) {
  return {
    id: 'campaign-calendar-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/campaign-calendar/overview' },
      { method: 'POST', path: '/api/campaign-calendar/validate' },
      { method: 'GET', path: '/api/campaign-calendar/policies' }
    ],
    checklist: createCampaignCalendarChecklist(snapshot)
  };
}
