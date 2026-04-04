import { createBenchmarkExchangeWorkspace, summarizeBenchmarkExchangeWorkspace, createBenchmarkExchangeNarratives, createBenchmarkExchangeCoverageGrid } from './domain-benchmark-exchange.mjs';
import { createBenchmarkExchangePolicies, validateBenchmarkExchangePolicies, summarizeBenchmarkExchangePolicies, createBenchmarkExchangeEscalationDeck } from './policies-benchmark-exchange.mjs';
import { createBenchmarkExchangeAnalyticsTimeline, createBenchmarkExchangeForecastEnvelope, createBenchmarkExchangeExceptionLedger, summarizeBenchmarkExchangeAnalytics } from './analytics-benchmark-exchange.mjs';
import { createBenchmarkExchangeOperationsBoard, createBenchmarkExchangeShiftChecklist, createBenchmarkExchangeIncidentDeck } from './operations-benchmark-exchange.mjs';
import { createBenchmarkExchangeReportCards, createBenchmarkExchangeReviewPackets, summarizeBenchmarkExchangeReporting } from './reporting-benchmark-exchange.mjs';
import { createBenchmarkExchangeAuditTrail, createBenchmarkExchangeEvidenceManifest, createBenchmarkExchangeReadinessAttestation } from './audit-benchmark-exchange.mjs';
import { createBenchmarkExchangePlaybooks, createBenchmarkExchangeDecisionDeck, createBenchmarkExchangeEscalationMoments } from './playbooks-benchmark-exchange.mjs';

export function buildBenchmarkExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkExchangeWorkspace(workspaceName);
  const policies = createBenchmarkExchangePolicies();
  return {
    workspace,
    summary: summarizeBenchmarkExchangeWorkspace(workspace),
    narratives: createBenchmarkExchangeNarratives(workspace),
    coverage: createBenchmarkExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkExchangePolicies(policies),
    validation: validateBenchmarkExchangePolicies(policies),
    escalationDeck: createBenchmarkExchangeEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkExchangeAnalyticsTimeline(),
      forecast: createBenchmarkExchangeForecastEnvelope(),
      exceptions: createBenchmarkExchangeExceptionLedger(),
      summary: summarizeBenchmarkExchangeAnalytics()
    },
    operations: {
      board: createBenchmarkExchangeOperationsBoard(),
      checklist: createBenchmarkExchangeShiftChecklist(),
      incidents: createBenchmarkExchangeIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkExchangeReportCards(),
      packets: createBenchmarkExchangeReviewPackets(),
      summary: summarizeBenchmarkExchangeReporting()
    },
    audit: {
      trail: createBenchmarkExchangeAuditTrail(),
      manifest: createBenchmarkExchangeEvidenceManifest(),
      attestation: createBenchmarkExchangeReadinessAttestation()
    },
    playbooks: createBenchmarkExchangePlaybooks(),
    decisions: createBenchmarkExchangeDecisionDeck(),
    escalationMoments: createBenchmarkExchangeEscalationMoments()
  };
}

export function createBenchmarkExchangeReadinessBoard(snapshot = buildBenchmarkExchangeSnapshot()) {
  return [
    { id: 'benchmark-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkExchangeApiDocument(snapshot = buildBenchmarkExchangeSnapshot()) {
  return {
    id: 'benchmark-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-exchange/overview' },
      { method: 'GET', path: '/api/benchmark-exchange/reporting' },
      { method: 'POST', path: '/api/benchmark-exchange/validate' },
      { method: 'GET', path: '/api/benchmark-exchange/audit' }
    ],
    readiness: createBenchmarkExchangeReadinessBoard(snapshot)
  };
}

export function createBenchmarkExchangeRouteSummary(snapshot = buildBenchmarkExchangeSnapshot()) {
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

