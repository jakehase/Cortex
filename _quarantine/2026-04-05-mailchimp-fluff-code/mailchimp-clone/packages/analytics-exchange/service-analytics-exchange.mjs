import { createAnalyticsExchangeWorkspace, summarizeAnalyticsExchangeWorkspace, createAnalyticsExchangeNarratives, createAnalyticsExchangeCoverageGrid } from './domain-analytics-exchange.mjs';
import { createAnalyticsExchangePolicies, validateAnalyticsExchangePolicies, summarizeAnalyticsExchangePolicies, createAnalyticsExchangeEscalationDeck } from './policies-analytics-exchange.mjs';
import { createAnalyticsExchangeAnalyticsTimeline, createAnalyticsExchangeForecastEnvelope, createAnalyticsExchangeExceptionLedger, summarizeAnalyticsExchangeAnalytics } from './analytics-analytics-exchange.mjs';
import { createAnalyticsExchangeOperationsBoard, createAnalyticsExchangeShiftChecklist, createAnalyticsExchangeIncidentDeck } from './operations-analytics-exchange.mjs';
import { createAnalyticsExchangeReportCards, createAnalyticsExchangeReviewPackets, summarizeAnalyticsExchangeReporting } from './reporting-analytics-exchange.mjs';
import { createAnalyticsExchangeAuditTrail, createAnalyticsExchangeEvidenceManifest, createAnalyticsExchangeReadinessAttestation } from './audit-analytics-exchange.mjs';
import { createAnalyticsExchangePlaybooks, createAnalyticsExchangeDecisionDeck, createAnalyticsExchangeEscalationMoments } from './playbooks-analytics-exchange.mjs';

export function buildAnalyticsExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsExchangeWorkspace(workspaceName);
  const policies = createAnalyticsExchangePolicies();
  return {
    workspace,
    summary: summarizeAnalyticsExchangeWorkspace(workspace),
    narratives: createAnalyticsExchangeNarratives(workspace),
    coverage: createAnalyticsExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsExchangePolicies(policies),
    validation: validateAnalyticsExchangePolicies(policies),
    escalationDeck: createAnalyticsExchangeEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsExchangeAnalyticsTimeline(),
      forecast: createAnalyticsExchangeForecastEnvelope(),
      exceptions: createAnalyticsExchangeExceptionLedger(),
      summary: summarizeAnalyticsExchangeAnalytics()
    },
    operations: {
      board: createAnalyticsExchangeOperationsBoard(),
      checklist: createAnalyticsExchangeShiftChecklist(),
      incidents: createAnalyticsExchangeIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsExchangeReportCards(),
      packets: createAnalyticsExchangeReviewPackets(),
      summary: summarizeAnalyticsExchangeReporting()
    },
    audit: {
      trail: createAnalyticsExchangeAuditTrail(),
      manifest: createAnalyticsExchangeEvidenceManifest(),
      attestation: createAnalyticsExchangeReadinessAttestation()
    },
    playbooks: createAnalyticsExchangePlaybooks(),
    decisions: createAnalyticsExchangeDecisionDeck(),
    escalationMoments: createAnalyticsExchangeEscalationMoments()
  };
}

export function createAnalyticsExchangeReadinessBoard(snapshot = buildAnalyticsExchangeSnapshot()) {
  return [
    { id: 'analytics-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsExchangeApiDocument(snapshot = buildAnalyticsExchangeSnapshot()) {
  return {
    id: 'analytics-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-exchange/overview' },
      { method: 'GET', path: '/api/analytics-exchange/reporting' },
      { method: 'POST', path: '/api/analytics-exchange/validate' },
      { method: 'GET', path: '/api/analytics-exchange/audit' }
    ],
    readiness: createAnalyticsExchangeReadinessBoard(snapshot)
  };
}

export function createAnalyticsExchangeRouteSummary(snapshot = buildAnalyticsExchangeSnapshot()) {
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

