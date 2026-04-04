import { createLifecycleLedgerWorkspace, summarizeLifecycleLedgerWorkspace, createLifecycleLedgerNarratives, createLifecycleLedgerCoverageGrid } from './domain-lifecycle-ledger.mjs';
import { createLifecycleLedgerPolicies, validateLifecycleLedgerPolicies, summarizeLifecycleLedgerPolicies, createLifecycleLedgerEscalationDeck } from './policies-lifecycle-ledger.mjs';
import { createLifecycleLedgerAnalyticsTimeline, createLifecycleLedgerForecastEnvelope, createLifecycleLedgerExceptionLedger, summarizeLifecycleLedgerAnalytics } from './analytics-lifecycle-ledger.mjs';
import { createLifecycleLedgerOperationsBoard, createLifecycleLedgerShiftChecklist, createLifecycleLedgerIncidentDeck } from './operations-lifecycle-ledger.mjs';
import { createLifecycleLedgerReportCards, createLifecycleLedgerReviewPackets, summarizeLifecycleLedgerReporting } from './reporting-lifecycle-ledger.mjs';
import { createLifecycleLedgerAuditTrail, createLifecycleLedgerEvidenceManifest, createLifecycleLedgerReadinessAttestation } from './audit-lifecycle-ledger.mjs';
import { createLifecycleLedgerPlaybooks, createLifecycleLedgerDecisionDeck, createLifecycleLedgerEscalationMoments } from './playbooks-lifecycle-ledger.mjs';

export function buildLifecycleLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleLedgerWorkspace(workspaceName);
  const policies = createLifecycleLedgerPolicies();
  return {
    workspace,
    summary: summarizeLifecycleLedgerWorkspace(workspace),
    narratives: createLifecycleLedgerNarratives(workspace),
    coverage: createLifecycleLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleLedgerPolicies(policies),
    validation: validateLifecycleLedgerPolicies(policies),
    escalationDeck: createLifecycleLedgerEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleLedgerAnalyticsTimeline(),
      forecast: createLifecycleLedgerForecastEnvelope(),
      exceptions: createLifecycleLedgerExceptionLedger(),
      summary: summarizeLifecycleLedgerAnalytics()
    },
    operations: {
      board: createLifecycleLedgerOperationsBoard(),
      checklist: createLifecycleLedgerShiftChecklist(),
      incidents: createLifecycleLedgerIncidentDeck()
    },
    reporting: {
      cards: createLifecycleLedgerReportCards(),
      packets: createLifecycleLedgerReviewPackets(),
      summary: summarizeLifecycleLedgerReporting()
    },
    audit: {
      trail: createLifecycleLedgerAuditTrail(),
      manifest: createLifecycleLedgerEvidenceManifest(),
      attestation: createLifecycleLedgerReadinessAttestation()
    },
    playbooks: createLifecycleLedgerPlaybooks(),
    decisions: createLifecycleLedgerDecisionDeck(),
    escalationMoments: createLifecycleLedgerEscalationMoments()
  };
}

export function createLifecycleLedgerReadinessBoard(snapshot = buildLifecycleLedgerSnapshot()) {
  return [
    { id: 'lifecycle-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleLedgerApiDocument(snapshot = buildLifecycleLedgerSnapshot()) {
  return {
    id: 'lifecycle-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-ledger/overview' },
      { method: 'GET', path: '/api/lifecycle-ledger/reporting' },
      { method: 'POST', path: '/api/lifecycle-ledger/validate' },
      { method: 'GET', path: '/api/lifecycle-ledger/audit' }
    ],
    readiness: createLifecycleLedgerReadinessBoard(snapshot)
  };
}

export function createLifecycleLedgerRouteSummary(snapshot = buildLifecycleLedgerSnapshot()) {
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

