import { createDataLedgerWorkspace, summarizeDataLedgerWorkspace, createDataLedgerNarratives, createDataLedgerCoverageGrid } from './domain-data-ledger.mjs';
import { createDataLedgerPolicies, validateDataLedgerPolicies, summarizeDataLedgerPolicies, createDataLedgerEscalationDeck } from './policies-data-ledger.mjs';
import { createDataLedgerAnalyticsTimeline, createDataLedgerForecastEnvelope, createDataLedgerExceptionLedger, summarizeDataLedgerAnalytics } from './analytics-data-ledger.mjs';
import { createDataLedgerOperationsBoard, createDataLedgerShiftChecklist, createDataLedgerIncidentDeck } from './operations-data-ledger.mjs';
import { createDataLedgerReportCards, createDataLedgerReviewPackets, summarizeDataLedgerReporting } from './reporting-data-ledger.mjs';
import { createDataLedgerAuditTrail, createDataLedgerEvidenceManifest, createDataLedgerReadinessAttestation } from './audit-data-ledger.mjs';
import { createDataLedgerPlaybooks, createDataLedgerDecisionDeck, createDataLedgerEscalationMoments } from './playbooks-data-ledger.mjs';

export function buildDataLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataLedgerWorkspace(workspaceName);
  const policies = createDataLedgerPolicies();
  return {
    workspace,
    summary: summarizeDataLedgerWorkspace(workspace),
    narratives: createDataLedgerNarratives(workspace),
    coverage: createDataLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataLedgerPolicies(policies),
    validation: validateDataLedgerPolicies(policies),
    escalationDeck: createDataLedgerEscalationDeck(policies),
    analytics: {
      timeline: createDataLedgerAnalyticsTimeline(),
      forecast: createDataLedgerForecastEnvelope(),
      exceptions: createDataLedgerExceptionLedger(),
      summary: summarizeDataLedgerAnalytics()
    },
    operations: {
      board: createDataLedgerOperationsBoard(),
      checklist: createDataLedgerShiftChecklist(),
      incidents: createDataLedgerIncidentDeck()
    },
    reporting: {
      cards: createDataLedgerReportCards(),
      packets: createDataLedgerReviewPackets(),
      summary: summarizeDataLedgerReporting()
    },
    audit: {
      trail: createDataLedgerAuditTrail(),
      manifest: createDataLedgerEvidenceManifest(),
      attestation: createDataLedgerReadinessAttestation()
    },
    playbooks: createDataLedgerPlaybooks(),
    decisions: createDataLedgerDecisionDeck(),
    escalationMoments: createDataLedgerEscalationMoments()
  };
}

export function createDataLedgerReadinessBoard(snapshot = buildDataLedgerSnapshot()) {
  return [
    { id: 'data-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataLedgerApiDocument(snapshot = buildDataLedgerSnapshot()) {
  return {
    id: 'data-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-ledger/overview' },
      { method: 'GET', path: '/api/data-ledger/reporting' },
      { method: 'POST', path: '/api/data-ledger/validate' },
      { method: 'GET', path: '/api/data-ledger/audit' }
    ],
    readiness: createDataLedgerReadinessBoard(snapshot)
  };
}

export function createDataLedgerRouteSummary(snapshot = buildDataLedgerSnapshot()) {
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

