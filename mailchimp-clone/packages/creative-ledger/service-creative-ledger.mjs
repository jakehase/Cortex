import { createCreativeLedgerWorkspace, summarizeCreativeLedgerWorkspace, createCreativeLedgerNarratives, createCreativeLedgerCoverageGrid } from './domain-creative-ledger.mjs';
import { createCreativeLedgerPolicies, validateCreativeLedgerPolicies, summarizeCreativeLedgerPolicies, createCreativeLedgerEscalationDeck } from './policies-creative-ledger.mjs';
import { createCreativeLedgerAnalyticsTimeline, createCreativeLedgerForecastEnvelope, createCreativeLedgerExceptionLedger, summarizeCreativeLedgerAnalytics } from './analytics-creative-ledger.mjs';
import { createCreativeLedgerOperationsBoard, createCreativeLedgerShiftChecklist, createCreativeLedgerIncidentDeck } from './operations-creative-ledger.mjs';
import { createCreativeLedgerReportCards, createCreativeLedgerReviewPackets, summarizeCreativeLedgerReporting } from './reporting-creative-ledger.mjs';
import { createCreativeLedgerAuditTrail, createCreativeLedgerEvidenceManifest, createCreativeLedgerReadinessAttestation } from './audit-creative-ledger.mjs';
import { createCreativeLedgerPlaybooks, createCreativeLedgerDecisionDeck, createCreativeLedgerEscalationMoments } from './playbooks-creative-ledger.mjs';

export function buildCreativeLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeLedgerWorkspace(workspaceName);
  const policies = createCreativeLedgerPolicies();
  return {
    workspace,
    summary: summarizeCreativeLedgerWorkspace(workspace),
    narratives: createCreativeLedgerNarratives(workspace),
    coverage: createCreativeLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeLedgerPolicies(policies),
    validation: validateCreativeLedgerPolicies(policies),
    escalationDeck: createCreativeLedgerEscalationDeck(policies),
    analytics: {
      timeline: createCreativeLedgerAnalyticsTimeline(),
      forecast: createCreativeLedgerForecastEnvelope(),
      exceptions: createCreativeLedgerExceptionLedger(),
      summary: summarizeCreativeLedgerAnalytics()
    },
    operations: {
      board: createCreativeLedgerOperationsBoard(),
      checklist: createCreativeLedgerShiftChecklist(),
      incidents: createCreativeLedgerIncidentDeck()
    },
    reporting: {
      cards: createCreativeLedgerReportCards(),
      packets: createCreativeLedgerReviewPackets(),
      summary: summarizeCreativeLedgerReporting()
    },
    audit: {
      trail: createCreativeLedgerAuditTrail(),
      manifest: createCreativeLedgerEvidenceManifest(),
      attestation: createCreativeLedgerReadinessAttestation()
    },
    playbooks: createCreativeLedgerPlaybooks(),
    decisions: createCreativeLedgerDecisionDeck(),
    escalationMoments: createCreativeLedgerEscalationMoments()
  };
}

export function createCreativeLedgerReadinessBoard(snapshot = buildCreativeLedgerSnapshot()) {
  return [
    { id: 'creative-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeLedgerApiDocument(snapshot = buildCreativeLedgerSnapshot()) {
  return {
    id: 'creative-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-ledger/overview' },
      { method: 'GET', path: '/api/creative-ledger/reporting' },
      { method: 'POST', path: '/api/creative-ledger/validate' },
      { method: 'GET', path: '/api/creative-ledger/audit' }
    ],
    readiness: createCreativeLedgerReadinessBoard(snapshot)
  };
}

export function createCreativeLedgerRouteSummary(snapshot = buildCreativeLedgerSnapshot()) {
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

