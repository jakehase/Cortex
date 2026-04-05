import { createLoyaltyLedgerWorkspace, summarizeLoyaltyLedgerWorkspace, createLoyaltyLedgerNarratives, createLoyaltyLedgerCoverageGrid } from './domain-loyalty-ledger.mjs';
import { createLoyaltyLedgerPolicies, validateLoyaltyLedgerPolicies, summarizeLoyaltyLedgerPolicies, createLoyaltyLedgerEscalationDeck } from './policies-loyalty-ledger.mjs';
import { createLoyaltyLedgerAnalyticsTimeline, createLoyaltyLedgerForecastEnvelope, createLoyaltyLedgerExceptionLedger, summarizeLoyaltyLedgerAnalytics } from './analytics-loyalty-ledger.mjs';
import { createLoyaltyLedgerOperationsBoard, createLoyaltyLedgerShiftChecklist, createLoyaltyLedgerIncidentDeck } from './operations-loyalty-ledger.mjs';
import { createLoyaltyLedgerReportCards, createLoyaltyLedgerReviewPackets, summarizeLoyaltyLedgerReporting } from './reporting-loyalty-ledger.mjs';
import { createLoyaltyLedgerAuditTrail, createLoyaltyLedgerEvidenceManifest, createLoyaltyLedgerReadinessAttestation } from './audit-loyalty-ledger.mjs';
import { createLoyaltyLedgerPlaybooks, createLoyaltyLedgerDecisionDeck, createLoyaltyLedgerEscalationMoments } from './playbooks-loyalty-ledger.mjs';

export function buildLoyaltyLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyLedgerWorkspace(workspaceName);
  const policies = createLoyaltyLedgerPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyLedgerWorkspace(workspace),
    narratives: createLoyaltyLedgerNarratives(workspace),
    coverage: createLoyaltyLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyLedgerPolicies(policies),
    validation: validateLoyaltyLedgerPolicies(policies),
    escalationDeck: createLoyaltyLedgerEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyLedgerAnalyticsTimeline(),
      forecast: createLoyaltyLedgerForecastEnvelope(),
      exceptions: createLoyaltyLedgerExceptionLedger(),
      summary: summarizeLoyaltyLedgerAnalytics()
    },
    operations: {
      board: createLoyaltyLedgerOperationsBoard(),
      checklist: createLoyaltyLedgerShiftChecklist(),
      incidents: createLoyaltyLedgerIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyLedgerReportCards(),
      packets: createLoyaltyLedgerReviewPackets(),
      summary: summarizeLoyaltyLedgerReporting()
    },
    audit: {
      trail: createLoyaltyLedgerAuditTrail(),
      manifest: createLoyaltyLedgerEvidenceManifest(),
      attestation: createLoyaltyLedgerReadinessAttestation()
    },
    playbooks: createLoyaltyLedgerPlaybooks(),
    decisions: createLoyaltyLedgerDecisionDeck(),
    escalationMoments: createLoyaltyLedgerEscalationMoments()
  };
}

export function createLoyaltyLedgerReadinessBoard(snapshot = buildLoyaltyLedgerSnapshot()) {
  return [
    { id: 'loyalty-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyLedgerApiDocument(snapshot = buildLoyaltyLedgerSnapshot()) {
  return {
    id: 'loyalty-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-ledger/overview' },
      { method: 'GET', path: '/api/loyalty-ledger/reporting' },
      { method: 'POST', path: '/api/loyalty-ledger/validate' },
      { method: 'GET', path: '/api/loyalty-ledger/audit' }
    ],
    readiness: createLoyaltyLedgerReadinessBoard(snapshot)
  };
}

export function createLoyaltyLedgerRouteSummary(snapshot = buildLoyaltyLedgerSnapshot()) {
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

