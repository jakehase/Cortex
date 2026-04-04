import { createConsentLedgerWorkspace, summarizeConsentLedger, createConsentLedgerNarratives } from './domain-consent-ledger.mjs';
import { createConsentLedgerPolicies, validateConsentLedgerPolicies, policySummaryConsentLedger } from './domain-consent-ledger-policies.mjs';

export function buildConsentLedgerSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createConsentLedgerWorkspace(workspaceName);
  const policies = createConsentLedgerPolicies();
  return { workspace, summary: summarizeConsentLedger(workspace), narratives: createConsentLedgerNarratives(workspace), policies, policySummary: policySummaryConsentLedger(policies), validation: validateConsentLedgerPolicies(policies) };
}

export function createConsentLedgerChecklist(snapshot = buildConsentLedgerSnapshot()) {
  return [
    { id: "consent-ledger-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "consent-ledger-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "consent-ledger-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createConsentLedgerApiDocument(snapshot = buildConsentLedgerSnapshot()) {
  return {
    id: "consent-ledger-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/consent-ledger/overview' },
      { method: 'POST', path: '/api/consent-ledger/validate' },
      { method: 'GET', path: '/api/consent-ledger/policies' }
    ],
    checklist: createConsentLedgerChecklist(snapshot)
  };
}

