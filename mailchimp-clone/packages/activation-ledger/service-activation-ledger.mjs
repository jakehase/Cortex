import { createActivationLedgerWorkspace, summarizeActivationLedgerWorkspace, createActivationLedgerNarratives, createActivationLedgerCoverageGrid } from './domain-activation-ledger.mjs';
import { createActivationLedgerPolicies, validateActivationLedgerPolicies, summarizeActivationLedgerPolicies, createActivationLedgerEscalationDeck } from './policies-activation-ledger.mjs';
import { createActivationLedgerAnalyticsTimeline, createActivationLedgerForecastEnvelope, createActivationLedgerExceptionLedger, summarizeActivationLedgerAnalytics } from './analytics-activation-ledger.mjs';
import { createActivationLedgerOperationsBoard, createActivationLedgerShiftChecklist, createActivationLedgerIncidentDeck } from './operations-activation-ledger.mjs';
import { createActivationLedgerReportCards, createActivationLedgerReviewPackets, summarizeActivationLedgerReporting } from './reporting-activation-ledger.mjs';
import { createActivationLedgerAuditTrail, createActivationLedgerEvidenceManifest, createActivationLedgerReadinessAttestation } from './audit-activation-ledger.mjs';
import { createActivationLedgerPlaybooks, createActivationLedgerDecisionDeck, createActivationLedgerEscalationMoments } from './playbooks-activation-ledger.mjs';

export function buildActivationLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationLedgerWorkspace(workspaceName);
  const policies = createActivationLedgerPolicies();
  return {
    workspace,
    summary: summarizeActivationLedgerWorkspace(workspace),
    narratives: createActivationLedgerNarratives(workspace),
    coverage: createActivationLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationLedgerPolicies(policies),
    validation: validateActivationLedgerPolicies(policies),
    escalationDeck: createActivationLedgerEscalationDeck(policies),
    analytics: {
      timeline: createActivationLedgerAnalyticsTimeline(),
      forecast: createActivationLedgerForecastEnvelope(),
      exceptions: createActivationLedgerExceptionLedger(),
      summary: summarizeActivationLedgerAnalytics()
    },
    operations: {
      board: createActivationLedgerOperationsBoard(),
      checklist: createActivationLedgerShiftChecklist(),
      incidents: createActivationLedgerIncidentDeck()
    },
    reporting: {
      cards: createActivationLedgerReportCards(),
      packets: createActivationLedgerReviewPackets(),
      summary: summarizeActivationLedgerReporting()
    },
    audit: {
      trail: createActivationLedgerAuditTrail(),
      manifest: createActivationLedgerEvidenceManifest(),
      attestation: createActivationLedgerReadinessAttestation()
    },
    playbooks: createActivationLedgerPlaybooks(),
    decisions: createActivationLedgerDecisionDeck(),
    escalationMoments: createActivationLedgerEscalationMoments()
  };
}

export function createActivationLedgerReadinessBoard(snapshot = buildActivationLedgerSnapshot()) {
  return [
    { id: 'activation-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationLedgerApiDocument(snapshot = buildActivationLedgerSnapshot()) {
  return {
    id: 'activation-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-ledger/overview' },
      { method: 'GET', path: '/api/activation-ledger/reporting' },
      { method: 'POST', path: '/api/activation-ledger/validate' },
      { method: 'GET', path: '/api/activation-ledger/audit' }
    ],
    readiness: createActivationLedgerReadinessBoard(snapshot)
  };
}

export function createActivationLedgerRouteSummary(snapshot = buildActivationLedgerSnapshot()) {
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

