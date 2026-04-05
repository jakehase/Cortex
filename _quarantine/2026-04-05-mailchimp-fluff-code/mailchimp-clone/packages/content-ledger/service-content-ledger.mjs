import { createContentLedgerWorkspace, summarizeContentLedgerWorkspace, createContentLedgerNarratives, createContentLedgerCoverageGrid } from './domain-content-ledger.mjs';
import { createContentLedgerPolicies, validateContentLedgerPolicies, summarizeContentLedgerPolicies, createContentLedgerEscalationDeck } from './policies-content-ledger.mjs';
import { createContentLedgerAnalyticsTimeline, createContentLedgerForecastEnvelope, createContentLedgerExceptionLedger, summarizeContentLedgerAnalytics } from './analytics-content-ledger.mjs';
import { createContentLedgerOperationsBoard, createContentLedgerShiftChecklist, createContentLedgerIncidentDeck } from './operations-content-ledger.mjs';
import { createContentLedgerReportCards, createContentLedgerReviewPackets, summarizeContentLedgerReporting } from './reporting-content-ledger.mjs';
import { createContentLedgerAuditTrail, createContentLedgerEvidenceManifest, createContentLedgerReadinessAttestation } from './audit-content-ledger.mjs';
import { createContentLedgerPlaybooks, createContentLedgerDecisionDeck, createContentLedgerEscalationMoments } from './playbooks-content-ledger.mjs';

export function buildContentLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentLedgerWorkspace(workspaceName);
  const policies = createContentLedgerPolicies();
  return {
    workspace,
    summary: summarizeContentLedgerWorkspace(workspace),
    narratives: createContentLedgerNarratives(workspace),
    coverage: createContentLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentLedgerPolicies(policies),
    validation: validateContentLedgerPolicies(policies),
    escalationDeck: createContentLedgerEscalationDeck(policies),
    analytics: {
      timeline: createContentLedgerAnalyticsTimeline(),
      forecast: createContentLedgerForecastEnvelope(),
      exceptions: createContentLedgerExceptionLedger(),
      summary: summarizeContentLedgerAnalytics()
    },
    operations: {
      board: createContentLedgerOperationsBoard(),
      checklist: createContentLedgerShiftChecklist(),
      incidents: createContentLedgerIncidentDeck()
    },
    reporting: {
      cards: createContentLedgerReportCards(),
      packets: createContentLedgerReviewPackets(),
      summary: summarizeContentLedgerReporting()
    },
    audit: {
      trail: createContentLedgerAuditTrail(),
      manifest: createContentLedgerEvidenceManifest(),
      attestation: createContentLedgerReadinessAttestation()
    },
    playbooks: createContentLedgerPlaybooks(),
    decisions: createContentLedgerDecisionDeck(),
    escalationMoments: createContentLedgerEscalationMoments()
  };
}

export function createContentLedgerReadinessBoard(snapshot = buildContentLedgerSnapshot()) {
  return [
    { id: 'content-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentLedgerApiDocument(snapshot = buildContentLedgerSnapshot()) {
  return {
    id: 'content-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-ledger/overview' },
      { method: 'GET', path: '/api/content-ledger/reporting' },
      { method: 'POST', path: '/api/content-ledger/validate' },
      { method: 'GET', path: '/api/content-ledger/audit' }
    ],
    readiness: createContentLedgerReadinessBoard(snapshot)
  };
}

export function createContentLedgerRouteSummary(snapshot = buildContentLedgerSnapshot()) {
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

