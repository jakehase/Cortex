import { createChannelPlaybooksWorkspace, summarizeChannelPlaybooks, createChannelPlaybooksNarratives } from './domain-channel-playbooks.mjs';
import { createChannelPlaybooksPolicies, validateChannelPlaybooksPolicies, policySummaryChannelPlaybooks } from './domain-channel-playbooks-policies.mjs';

export function buildChannelPlaybooksSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createChannelPlaybooksWorkspace(workspaceName);
  const policies = createChannelPlaybooksPolicies();
  return { workspace, summary: summarizeChannelPlaybooks(workspace), narratives: createChannelPlaybooksNarratives(workspace), policies, policySummary: policySummaryChannelPlaybooks(policies), validation: validateChannelPlaybooksPolicies(policies) };
}

export function createChannelPlaybooksChecklist(snapshot = buildChannelPlaybooksSnapshot()) {
  return [
    { id: "channel-playbooks-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "channel-playbooks-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "channel-playbooks-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createChannelPlaybooksApiDocument(snapshot = buildChannelPlaybooksSnapshot()) {
  return {
    id: "channel-playbooks-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/channel-playbooks/overview' },
      { method: 'POST', path: '/api/channel-playbooks/validate' },
      { method: 'GET', path: '/api/channel-playbooks/policies' }
    ],
    checklist: createChannelPlaybooksChecklist(snapshot)
  };
}

