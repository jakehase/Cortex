import { createCustomerLedgerWorkspace, summarizeCustomerLedgerWorkspace, createCustomerLedgerNarratives, createCustomerLedgerCoverageGrid } from './domain-customer-ledger.mjs';
import { createCustomerLedgerPolicies, validateCustomerLedgerPolicies, summarizeCustomerLedgerPolicies, createCustomerLedgerEscalationDeck } from './policies-customer-ledger.mjs';
import { createCustomerLedgerAnalyticsTimeline, createCustomerLedgerForecastEnvelope, createCustomerLedgerExceptionLedger, summarizeCustomerLedgerAnalytics } from './analytics-customer-ledger.mjs';
import { createCustomerLedgerOperationsBoard, createCustomerLedgerShiftChecklist, createCustomerLedgerIncidentDeck } from './operations-customer-ledger.mjs';
import { createCustomerLedgerReportCards, createCustomerLedgerReviewPackets, summarizeCustomerLedgerReporting } from './reporting-customer-ledger.mjs';
import { createCustomerLedgerAuditTrail, createCustomerLedgerEvidenceManifest, createCustomerLedgerReadinessAttestation } from './audit-customer-ledger.mjs';
import { createCustomerLedgerPlaybooks, createCustomerLedgerDecisionDeck, createCustomerLedgerEscalationMoments } from './playbooks-customer-ledger.mjs';

export function buildCustomerLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerLedgerWorkspace(workspaceName);
  const policies = createCustomerLedgerPolicies();
  return {
    workspace,
    summary: summarizeCustomerLedgerWorkspace(workspace),
    narratives: createCustomerLedgerNarratives(workspace),
    coverage: createCustomerLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerLedgerPolicies(policies),
    validation: validateCustomerLedgerPolicies(policies),
    escalationDeck: createCustomerLedgerEscalationDeck(policies),
    analytics: {
      timeline: createCustomerLedgerAnalyticsTimeline(),
      forecast: createCustomerLedgerForecastEnvelope(),
      exceptions: createCustomerLedgerExceptionLedger(),
      summary: summarizeCustomerLedgerAnalytics()
    },
    operations: {
      board: createCustomerLedgerOperationsBoard(),
      checklist: createCustomerLedgerShiftChecklist(),
      incidents: createCustomerLedgerIncidentDeck()
    },
    reporting: {
      cards: createCustomerLedgerReportCards(),
      packets: createCustomerLedgerReviewPackets(),
      summary: summarizeCustomerLedgerReporting()
    },
    audit: {
      trail: createCustomerLedgerAuditTrail(),
      manifest: createCustomerLedgerEvidenceManifest(),
      attestation: createCustomerLedgerReadinessAttestation()
    },
    playbooks: createCustomerLedgerPlaybooks(),
    decisions: createCustomerLedgerDecisionDeck(),
    escalationMoments: createCustomerLedgerEscalationMoments()
  };
}

export function createCustomerLedgerReadinessBoard(snapshot = buildCustomerLedgerSnapshot()) {
  return [
    { id: 'customer-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerLedgerApiDocument(snapshot = buildCustomerLedgerSnapshot()) {
  return {
    id: 'customer-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-ledger/overview' },
      { method: 'GET', path: '/api/customer-ledger/reporting' },
      { method: 'POST', path: '/api/customer-ledger/validate' },
      { method: 'GET', path: '/api/customer-ledger/audit' }
    ],
    readiness: createCustomerLedgerReadinessBoard(snapshot)
  };
}

export function createCustomerLedgerRouteSummary(snapshot = buildCustomerLedgerSnapshot()) {
  return {
    id: snapshot.workspace.id,
    title: snapshot.summary.title,
    focus: snapshot.workspace.focus,
    groupTitle: snapshot.summary.groupTitle,
    metricCount: snapshot.summary.metricCount,
    policyCount: snapshot.policySummary.total,
    executiveCards: snapshot.reporting.summary.executiveCards
  };
}

