import { createInsightsExchangeWorkspace, summarizeInsightsExchangeWorkspace, createInsightsExchangeNarratives, createInsightsExchangeCoverageGrid } from './domain-insights-exchange.mjs';
import { createInsightsExchangePolicies, validateInsightsExchangePolicies, summarizeInsightsExchangePolicies, createInsightsExchangeEscalationDeck } from './policies-insights-exchange.mjs';
import { createInsightsExchangeAnalyticsTimeline, createInsightsExchangeForecastEnvelope, createInsightsExchangeExceptionLedger, summarizeInsightsExchangeAnalytics } from './analytics-insights-exchange.mjs';
import { createInsightsExchangeOperationsBoard, createInsightsExchangeShiftChecklist, createInsightsExchangeIncidentDeck } from './operations-insights-exchange.mjs';
import { createInsightsExchangeReportCards, createInsightsExchangeReviewPackets, summarizeInsightsExchangeReporting } from './reporting-insights-exchange.mjs';
import { createInsightsExchangeAuditTrail, createInsightsExchangeEvidenceManifest, createInsightsExchangeReadinessAttestation } from './audit-insights-exchange.mjs';
import { createInsightsExchangePlaybooks, createInsightsExchangeDecisionDeck, createInsightsExchangeEscalationMoments } from './playbooks-insights-exchange.mjs';

export function buildInsightsExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsExchangeWorkspace(workspaceName);
  const policies = createInsightsExchangePolicies();
  return {
    workspace,
    summary: summarizeInsightsExchangeWorkspace(workspace),
    narratives: createInsightsExchangeNarratives(workspace),
    coverage: createInsightsExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsExchangePolicies(policies),
    validation: validateInsightsExchangePolicies(policies),
    escalationDeck: createInsightsExchangeEscalationDeck(policies),
    analytics: {
      timeline: createInsightsExchangeAnalyticsTimeline(),
      forecast: createInsightsExchangeForecastEnvelope(),
      exceptions: createInsightsExchangeExceptionLedger(),
      summary: summarizeInsightsExchangeAnalytics()
    },
    operations: {
      board: createInsightsExchangeOperationsBoard(),
      checklist: createInsightsExchangeShiftChecklist(),
      incidents: createInsightsExchangeIncidentDeck()
    },
    reporting: {
      cards: createInsightsExchangeReportCards(),
      packets: createInsightsExchangeReviewPackets(),
      summary: summarizeInsightsExchangeReporting()
    },
    audit: {
      trail: createInsightsExchangeAuditTrail(),
      manifest: createInsightsExchangeEvidenceManifest(),
      attestation: createInsightsExchangeReadinessAttestation()
    },
    playbooks: createInsightsExchangePlaybooks(),
    decisions: createInsightsExchangeDecisionDeck(),
    escalationMoments: createInsightsExchangeEscalationMoments()
  };
}

export function createInsightsExchangeReadinessBoard(snapshot = buildInsightsExchangeSnapshot()) {
  return [
    { id: 'insights-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsExchangeApiDocument(snapshot = buildInsightsExchangeSnapshot()) {
  return {
    id: 'insights-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-exchange/overview' },
      { method: 'GET', path: '/api/insights-exchange/reporting' },
      { method: 'POST', path: '/api/insights-exchange/validate' },
      { method: 'GET', path: '/api/insights-exchange/audit' }
    ],
    readiness: createInsightsExchangeReadinessBoard(snapshot)
  };
}

export function createInsightsExchangeRouteSummary(snapshot = buildInsightsExchangeSnapshot()) {
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

