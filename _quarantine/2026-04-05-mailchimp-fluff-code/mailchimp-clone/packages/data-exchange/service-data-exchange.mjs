import { createDataExchangeWorkspace, summarizeDataExchangeWorkspace, createDataExchangeNarratives, createDataExchangeCoverageGrid } from './domain-data-exchange.mjs';
import { createDataExchangePolicies, validateDataExchangePolicies, summarizeDataExchangePolicies, createDataExchangeEscalationDeck } from './policies-data-exchange.mjs';
import { createDataExchangeAnalyticsTimeline, createDataExchangeForecastEnvelope, createDataExchangeExceptionLedger, summarizeDataExchangeAnalytics } from './analytics-data-exchange.mjs';
import { createDataExchangeOperationsBoard, createDataExchangeShiftChecklist, createDataExchangeIncidentDeck } from './operations-data-exchange.mjs';
import { createDataExchangeReportCards, createDataExchangeReviewPackets, summarizeDataExchangeReporting } from './reporting-data-exchange.mjs';
import { createDataExchangeAuditTrail, createDataExchangeEvidenceManifest, createDataExchangeReadinessAttestation } from './audit-data-exchange.mjs';
import { createDataExchangePlaybooks, createDataExchangeDecisionDeck, createDataExchangeEscalationMoments } from './playbooks-data-exchange.mjs';

export function buildDataExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataExchangeWorkspace(workspaceName);
  const policies = createDataExchangePolicies();
  return {
    workspace,
    summary: summarizeDataExchangeWorkspace(workspace),
    narratives: createDataExchangeNarratives(workspace),
    coverage: createDataExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataExchangePolicies(policies),
    validation: validateDataExchangePolicies(policies),
    escalationDeck: createDataExchangeEscalationDeck(policies),
    analytics: {
      timeline: createDataExchangeAnalyticsTimeline(),
      forecast: createDataExchangeForecastEnvelope(),
      exceptions: createDataExchangeExceptionLedger(),
      summary: summarizeDataExchangeAnalytics()
    },
    operations: {
      board: createDataExchangeOperationsBoard(),
      checklist: createDataExchangeShiftChecklist(),
      incidents: createDataExchangeIncidentDeck()
    },
    reporting: {
      cards: createDataExchangeReportCards(),
      packets: createDataExchangeReviewPackets(),
      summary: summarizeDataExchangeReporting()
    },
    audit: {
      trail: createDataExchangeAuditTrail(),
      manifest: createDataExchangeEvidenceManifest(),
      attestation: createDataExchangeReadinessAttestation()
    },
    playbooks: createDataExchangePlaybooks(),
    decisions: createDataExchangeDecisionDeck(),
    escalationMoments: createDataExchangeEscalationMoments()
  };
}

export function createDataExchangeReadinessBoard(snapshot = buildDataExchangeSnapshot()) {
  return [
    { id: 'data-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataExchangeApiDocument(snapshot = buildDataExchangeSnapshot()) {
  return {
    id: 'data-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-exchange/overview' },
      { method: 'GET', path: '/api/data-exchange/reporting' },
      { method: 'POST', path: '/api/data-exchange/validate' },
      { method: 'GET', path: '/api/data-exchange/audit' }
    ],
    readiness: createDataExchangeReadinessBoard(snapshot)
  };
}

export function createDataExchangeRouteSummary(snapshot = buildDataExchangeSnapshot()) {
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

