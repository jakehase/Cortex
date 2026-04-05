import { createCollaborationLedgerWorkspace, summarizeCollaborationLedgerWorkspace, createCollaborationLedgerNarratives, createCollaborationLedgerCoverageGrid } from './domain-collaboration-ledger.mjs';
import { createCollaborationLedgerPolicies, validateCollaborationLedgerPolicies, summarizeCollaborationLedgerPolicies, createCollaborationLedgerEscalationDeck } from './policies-collaboration-ledger.mjs';
import { createCollaborationLedgerAnalyticsTimeline, createCollaborationLedgerForecastEnvelope, createCollaborationLedgerExceptionLedger, summarizeCollaborationLedgerAnalytics } from './analytics-collaboration-ledger.mjs';
import { createCollaborationLedgerOperationsBoard, createCollaborationLedgerShiftChecklist, createCollaborationLedgerIncidentDeck } from './operations-collaboration-ledger.mjs';
import { createCollaborationLedgerReportCards, createCollaborationLedgerReviewPackets, summarizeCollaborationLedgerReporting } from './reporting-collaboration-ledger.mjs';
import { createCollaborationLedgerAuditTrail, createCollaborationLedgerEvidenceManifest, createCollaborationLedgerReadinessAttestation } from './audit-collaboration-ledger.mjs';
import { createCollaborationLedgerPlaybooks, createCollaborationLedgerDecisionDeck, createCollaborationLedgerEscalationMoments } from './playbooks-collaboration-ledger.mjs';

export function buildCollaborationLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationLedgerWorkspace(workspaceName);
  const policies = createCollaborationLedgerPolicies();
  return {
    workspace,
    summary: summarizeCollaborationLedgerWorkspace(workspace),
    narratives: createCollaborationLedgerNarratives(workspace),
    coverage: createCollaborationLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationLedgerPolicies(policies),
    validation: validateCollaborationLedgerPolicies(policies),
    escalationDeck: createCollaborationLedgerEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationLedgerAnalyticsTimeline(),
      forecast: createCollaborationLedgerForecastEnvelope(),
      exceptions: createCollaborationLedgerExceptionLedger(),
      summary: summarizeCollaborationLedgerAnalytics()
    },
    operations: {
      board: createCollaborationLedgerOperationsBoard(),
      checklist: createCollaborationLedgerShiftChecklist(),
      incidents: createCollaborationLedgerIncidentDeck()
    },
    reporting: {
      cards: createCollaborationLedgerReportCards(),
      packets: createCollaborationLedgerReviewPackets(),
      summary: summarizeCollaborationLedgerReporting()
    },
    audit: {
      trail: createCollaborationLedgerAuditTrail(),
      manifest: createCollaborationLedgerEvidenceManifest(),
      attestation: createCollaborationLedgerReadinessAttestation()
    },
    playbooks: createCollaborationLedgerPlaybooks(),
    decisions: createCollaborationLedgerDecisionDeck(),
    escalationMoments: createCollaborationLedgerEscalationMoments()
  };
}

export function createCollaborationLedgerReadinessBoard(snapshot = buildCollaborationLedgerSnapshot()) {
  return [
    { id: 'collaboration-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationLedgerApiDocument(snapshot = buildCollaborationLedgerSnapshot()) {
  return {
    id: 'collaboration-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-ledger/overview' },
      { method: 'GET', path: '/api/collaboration-ledger/reporting' },
      { method: 'POST', path: '/api/collaboration-ledger/validate' },
      { method: 'GET', path: '/api/collaboration-ledger/audit' }
    ],
    readiness: createCollaborationLedgerReadinessBoard(snapshot)
  };
}

export function createCollaborationLedgerRouteSummary(snapshot = buildCollaborationLedgerSnapshot()) {
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

