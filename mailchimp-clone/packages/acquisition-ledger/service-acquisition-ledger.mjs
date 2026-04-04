import { createAcquisitionLedgerWorkspace, summarizeAcquisitionLedgerWorkspace, createAcquisitionLedgerNarratives, createAcquisitionLedgerCoverageGrid } from './domain-acquisition-ledger.mjs';
import { createAcquisitionLedgerPolicies, validateAcquisitionLedgerPolicies, summarizeAcquisitionLedgerPolicies, createAcquisitionLedgerEscalationDeck } from './policies-acquisition-ledger.mjs';
import { createAcquisitionLedgerAnalyticsTimeline, createAcquisitionLedgerForecastEnvelope, createAcquisitionLedgerExceptionLedger, summarizeAcquisitionLedgerAnalytics } from './analytics-acquisition-ledger.mjs';
import { createAcquisitionLedgerOperationsBoard, createAcquisitionLedgerShiftChecklist, createAcquisitionLedgerIncidentDeck } from './operations-acquisition-ledger.mjs';
import { createAcquisitionLedgerReportCards, createAcquisitionLedgerReviewPackets, summarizeAcquisitionLedgerReporting } from './reporting-acquisition-ledger.mjs';
import { createAcquisitionLedgerAuditTrail, createAcquisitionLedgerEvidenceManifest, createAcquisitionLedgerReadinessAttestation } from './audit-acquisition-ledger.mjs';
import { createAcquisitionLedgerPlaybooks, createAcquisitionLedgerDecisionDeck, createAcquisitionLedgerEscalationMoments } from './playbooks-acquisition-ledger.mjs';

export function buildAcquisitionLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionLedgerWorkspace(workspaceName);
  const policies = createAcquisitionLedgerPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionLedgerWorkspace(workspace),
    narratives: createAcquisitionLedgerNarratives(workspace),
    coverage: createAcquisitionLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionLedgerPolicies(policies),
    validation: validateAcquisitionLedgerPolicies(policies),
    escalationDeck: createAcquisitionLedgerEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionLedgerAnalyticsTimeline(),
      forecast: createAcquisitionLedgerForecastEnvelope(),
      exceptions: createAcquisitionLedgerExceptionLedger(),
      summary: summarizeAcquisitionLedgerAnalytics()
    },
    operations: {
      board: createAcquisitionLedgerOperationsBoard(),
      checklist: createAcquisitionLedgerShiftChecklist(),
      incidents: createAcquisitionLedgerIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionLedgerReportCards(),
      packets: createAcquisitionLedgerReviewPackets(),
      summary: summarizeAcquisitionLedgerReporting()
    },
    audit: {
      trail: createAcquisitionLedgerAuditTrail(),
      manifest: createAcquisitionLedgerEvidenceManifest(),
      attestation: createAcquisitionLedgerReadinessAttestation()
    },
    playbooks: createAcquisitionLedgerPlaybooks(),
    decisions: createAcquisitionLedgerDecisionDeck(),
    escalationMoments: createAcquisitionLedgerEscalationMoments()
  };
}

export function createAcquisitionLedgerReadinessBoard(snapshot = buildAcquisitionLedgerSnapshot()) {
  return [
    { id: 'acquisition-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionLedgerApiDocument(snapshot = buildAcquisitionLedgerSnapshot()) {
  return {
    id: 'acquisition-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-ledger/overview' },
      { method: 'GET', path: '/api/acquisition-ledger/reporting' },
      { method: 'POST', path: '/api/acquisition-ledger/validate' },
      { method: 'GET', path: '/api/acquisition-ledger/audit' }
    ],
    readiness: createAcquisitionLedgerReadinessBoard(snapshot)
  };
}

export function createAcquisitionLedgerRouteSummary(snapshot = buildAcquisitionLedgerSnapshot()) {
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

