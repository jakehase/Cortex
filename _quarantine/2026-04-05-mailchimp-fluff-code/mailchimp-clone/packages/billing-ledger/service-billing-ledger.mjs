import { createBillingLedgerWorkspace, summarizeBillingLedgerWorkspace, createBillingLedgerNarratives, createBillingLedgerCoverageGrid } from './domain-billing-ledger.mjs';
import { createBillingLedgerPolicies, validateBillingLedgerPolicies, summarizeBillingLedgerPolicies, createBillingLedgerEscalationDeck } from './policies-billing-ledger.mjs';
import { createBillingLedgerAnalyticsTimeline, createBillingLedgerForecastEnvelope, createBillingLedgerExceptionLedger, summarizeBillingLedgerAnalytics } from './analytics-billing-ledger.mjs';
import { createBillingLedgerOperationsBoard, createBillingLedgerShiftChecklist, createBillingLedgerIncidentDeck } from './operations-billing-ledger.mjs';
import { createBillingLedgerReportCards, createBillingLedgerReviewPackets, summarizeBillingLedgerReporting } from './reporting-billing-ledger.mjs';
import { createBillingLedgerAuditTrail, createBillingLedgerEvidenceManifest, createBillingLedgerReadinessAttestation } from './audit-billing-ledger.mjs';
import { createBillingLedgerPlaybooks, createBillingLedgerDecisionDeck, createBillingLedgerEscalationMoments } from './playbooks-billing-ledger.mjs';

export function buildBillingLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingLedgerWorkspace(workspaceName);
  const policies = createBillingLedgerPolicies();
  return {
    workspace,
    summary: summarizeBillingLedgerWorkspace(workspace),
    narratives: createBillingLedgerNarratives(workspace),
    coverage: createBillingLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingLedgerPolicies(policies),
    validation: validateBillingLedgerPolicies(policies),
    escalationDeck: createBillingLedgerEscalationDeck(policies),
    analytics: {
      timeline: createBillingLedgerAnalyticsTimeline(),
      forecast: createBillingLedgerForecastEnvelope(),
      exceptions: createBillingLedgerExceptionLedger(),
      summary: summarizeBillingLedgerAnalytics()
    },
    operations: {
      board: createBillingLedgerOperationsBoard(),
      checklist: createBillingLedgerShiftChecklist(),
      incidents: createBillingLedgerIncidentDeck()
    },
    reporting: {
      cards: createBillingLedgerReportCards(),
      packets: createBillingLedgerReviewPackets(),
      summary: summarizeBillingLedgerReporting()
    },
    audit: {
      trail: createBillingLedgerAuditTrail(),
      manifest: createBillingLedgerEvidenceManifest(),
      attestation: createBillingLedgerReadinessAttestation()
    },
    playbooks: createBillingLedgerPlaybooks(),
    decisions: createBillingLedgerDecisionDeck(),
    escalationMoments: createBillingLedgerEscalationMoments()
  };
}

export function createBillingLedgerReadinessBoard(snapshot = buildBillingLedgerSnapshot()) {
  return [
    { id: 'billing-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingLedgerApiDocument(snapshot = buildBillingLedgerSnapshot()) {
  return {
    id: 'billing-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-ledger/overview' },
      { method: 'GET', path: '/api/billing-ledger/reporting' },
      { method: 'POST', path: '/api/billing-ledger/validate' },
      { method: 'GET', path: '/api/billing-ledger/audit' }
    ],
    readiness: createBillingLedgerReadinessBoard(snapshot)
  };
}

export function createBillingLedgerRouteSummary(snapshot = buildBillingLedgerSnapshot()) {
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

