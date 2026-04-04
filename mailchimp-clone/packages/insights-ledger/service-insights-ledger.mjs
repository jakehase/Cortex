import { createInsightsLedgerWorkspace, summarizeInsightsLedgerWorkspace, createInsightsLedgerNarratives, createInsightsLedgerCoverageGrid } from './domain-insights-ledger.mjs';
import { createInsightsLedgerPolicies, validateInsightsLedgerPolicies, summarizeInsightsLedgerPolicies, createInsightsLedgerEscalationDeck } from './policies-insights-ledger.mjs';
import { createInsightsLedgerAnalyticsTimeline, createInsightsLedgerForecastEnvelope, createInsightsLedgerExceptionLedger, summarizeInsightsLedgerAnalytics } from './analytics-insights-ledger.mjs';
import { createInsightsLedgerOperationsBoard, createInsightsLedgerShiftChecklist, createInsightsLedgerIncidentDeck } from './operations-insights-ledger.mjs';
import { createInsightsLedgerReportCards, createInsightsLedgerReviewPackets, summarizeInsightsLedgerReporting } from './reporting-insights-ledger.mjs';
import { createInsightsLedgerAuditTrail, createInsightsLedgerEvidenceManifest, createInsightsLedgerReadinessAttestation } from './audit-insights-ledger.mjs';
import { createInsightsLedgerPlaybooks, createInsightsLedgerDecisionDeck, createInsightsLedgerEscalationMoments } from './playbooks-insights-ledger.mjs';

export function buildInsightsLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsLedgerWorkspace(workspaceName);
  const policies = createInsightsLedgerPolicies();
  return {
    workspace,
    summary: summarizeInsightsLedgerWorkspace(workspace),
    narratives: createInsightsLedgerNarratives(workspace),
    coverage: createInsightsLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsLedgerPolicies(policies),
    validation: validateInsightsLedgerPolicies(policies),
    escalationDeck: createInsightsLedgerEscalationDeck(policies),
    analytics: {
      timeline: createInsightsLedgerAnalyticsTimeline(),
      forecast: createInsightsLedgerForecastEnvelope(),
      exceptions: createInsightsLedgerExceptionLedger(),
      summary: summarizeInsightsLedgerAnalytics()
    },
    operations: {
      board: createInsightsLedgerOperationsBoard(),
      checklist: createInsightsLedgerShiftChecklist(),
      incidents: createInsightsLedgerIncidentDeck()
    },
    reporting: {
      cards: createInsightsLedgerReportCards(),
      packets: createInsightsLedgerReviewPackets(),
      summary: summarizeInsightsLedgerReporting()
    },
    audit: {
      trail: createInsightsLedgerAuditTrail(),
      manifest: createInsightsLedgerEvidenceManifest(),
      attestation: createInsightsLedgerReadinessAttestation()
    },
    playbooks: createInsightsLedgerPlaybooks(),
    decisions: createInsightsLedgerDecisionDeck(),
    escalationMoments: createInsightsLedgerEscalationMoments()
  };
}

export function createInsightsLedgerReadinessBoard(snapshot = buildInsightsLedgerSnapshot()) {
  return [
    { id: 'insights-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsLedgerApiDocument(snapshot = buildInsightsLedgerSnapshot()) {
  return {
    id: 'insights-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-ledger/overview' },
      { method: 'GET', path: '/api/insights-ledger/reporting' },
      { method: 'POST', path: '/api/insights-ledger/validate' },
      { method: 'GET', path: '/api/insights-ledger/audit' }
    ],
    readiness: createInsightsLedgerReadinessBoard(snapshot)
  };
}

export function createInsightsLedgerRouteSummary(snapshot = buildInsightsLedgerSnapshot()) {
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

