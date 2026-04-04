import { createInboxMacrosWorkspace, summarizeInboxMacros, createInboxMacrosNarratives } from './domain-inbox-macros.mjs';
import { createInboxMacrosPolicies, validateInboxMacrosPolicies, policySummaryInboxMacros } from './domain-inbox-macros-policies.mjs';

export function buildInboxMacrosSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createInboxMacrosWorkspace(workspaceName);
  const policies = createInboxMacrosPolicies();
  return {
    workspace,
    summary: summarizeInboxMacros(workspace),
    narratives: createInboxMacrosNarratives(workspace),
    policies,
    policySummary: policySummaryInboxMacros(policies),
    validation: validateInboxMacrosPolicies(policies)
  };
}

export function createInboxMacrosChecklist(snapshot = buildInboxMacrosSnapshot()) {
  return [
    { id: 'inbox-macros-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'inbox-macros-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'inbox-macros-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createInboxMacrosApiDocument(snapshot = buildInboxMacrosSnapshot()) {
  return {
    id: 'inbox-macros-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/inbox-macros/overview' },
      { method: 'POST', path: '/api/inbox-macros/validate' },
      { method: 'GET', path: '/api/inbox-macros/policies' }
    ],
    checklist: createInboxMacrosChecklist(snapshot)
  };
}
