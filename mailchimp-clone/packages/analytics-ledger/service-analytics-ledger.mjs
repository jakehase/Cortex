import { createAnalyticsLedgerWorkspace, summarizeAnalyticsLedgerWorkspace, createAnalyticsLedgerNarratives, createAnalyticsLedgerCoverageGrid } from './domain-analytics-ledger.mjs';
import { createAnalyticsLedgerPolicies, validateAnalyticsLedgerPolicies, summarizeAnalyticsLedgerPolicies, createAnalyticsLedgerEscalationDeck } from './policies-analytics-ledger.mjs';
import { createAnalyticsLedgerAnalyticsTimeline, createAnalyticsLedgerForecastEnvelope, createAnalyticsLedgerExceptionLedger, summarizeAnalyticsLedgerAnalytics } from './analytics-analytics-ledger.mjs';
import { createAnalyticsLedgerOperationsBoard, createAnalyticsLedgerShiftChecklist, createAnalyticsLedgerIncidentDeck } from './operations-analytics-ledger.mjs';
import { createAnalyticsLedgerReportCards, createAnalyticsLedgerReviewPackets, summarizeAnalyticsLedgerReporting } from './reporting-analytics-ledger.mjs';
import { createAnalyticsLedgerAuditTrail, createAnalyticsLedgerEvidenceManifest, createAnalyticsLedgerReadinessAttestation } from './audit-analytics-ledger.mjs';
import { createAnalyticsLedgerPlaybooks, createAnalyticsLedgerDecisionDeck, createAnalyticsLedgerEscalationMoments } from './playbooks-analytics-ledger.mjs';

export function buildAnalyticsLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsLedgerWorkspace(workspaceName);
  const policies = createAnalyticsLedgerPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsLedgerWorkspace(workspace),
    narratives: createAnalyticsLedgerNarratives(workspace),
    coverage: createAnalyticsLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsLedgerPolicies(policies),
    validation: validateAnalyticsLedgerPolicies(policies),
    escalationDeck: createAnalyticsLedgerEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsLedgerAnalyticsTimeline(),
      forecast: createAnalyticsLedgerForecastEnvelope(),
      exceptions: createAnalyticsLedgerExceptionLedger(),
      summary: summarizeAnalyticsLedgerAnalytics()
    },
    operations: {
      board: createAnalyticsLedgerOperationsBoard(),
      checklist: createAnalyticsLedgerShiftChecklist(),
      incidents: createAnalyticsLedgerIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsLedgerReportCards(),
      packets: createAnalyticsLedgerReviewPackets(),
      summary: summarizeAnalyticsLedgerReporting()
    },
    audit: {
      trail: createAnalyticsLedgerAuditTrail(),
      manifest: createAnalyticsLedgerEvidenceManifest(),
      attestation: createAnalyticsLedgerReadinessAttestation()
    },
    playbooks: createAnalyticsLedgerPlaybooks(),
    decisions: createAnalyticsLedgerDecisionDeck(),
    escalationMoments: createAnalyticsLedgerEscalationMoments()
  };
}

export function createAnalyticsLedgerReadinessBoard(snapshot = buildAnalyticsLedgerSnapshot()) {
  return [
    { id: 'analytics-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsLedgerApiDocument(snapshot = buildAnalyticsLedgerSnapshot()) {
  return {
    id: 'analytics-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-ledger/overview' },
      { method: 'GET', path: '/api/analytics-ledger/reporting' },
      { method: 'POST', path: '/api/analytics-ledger/validate' },
      { method: 'GET', path: '/api/analytics-ledger/audit' }
    ],
    readiness: createAnalyticsLedgerReadinessBoard(snapshot)
  };
}

export function createAnalyticsLedgerRouteSummary(snapshot = buildAnalyticsLedgerSnapshot()) {
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

