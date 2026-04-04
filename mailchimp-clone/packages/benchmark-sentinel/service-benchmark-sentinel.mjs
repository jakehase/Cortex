import { createBenchmarkSentinelWorkspace, summarizeBenchmarkSentinelWorkspace, createBenchmarkSentinelNarratives, createBenchmarkSentinelCoverageGrid } from './domain-benchmark-sentinel.mjs';
import { createBenchmarkSentinelPolicies, validateBenchmarkSentinelPolicies, summarizeBenchmarkSentinelPolicies, createBenchmarkSentinelEscalationDeck } from './policies-benchmark-sentinel.mjs';
import { createBenchmarkSentinelAnalyticsTimeline, createBenchmarkSentinelForecastEnvelope, createBenchmarkSentinelExceptionLedger, summarizeBenchmarkSentinelAnalytics } from './analytics-benchmark-sentinel.mjs';
import { createBenchmarkSentinelOperationsBoard, createBenchmarkSentinelShiftChecklist, createBenchmarkSentinelIncidentDeck } from './operations-benchmark-sentinel.mjs';
import { createBenchmarkSentinelReportCards, createBenchmarkSentinelReviewPackets, summarizeBenchmarkSentinelReporting } from './reporting-benchmark-sentinel.mjs';
import { createBenchmarkSentinelAuditTrail, createBenchmarkSentinelEvidenceManifest, createBenchmarkSentinelReadinessAttestation } from './audit-benchmark-sentinel.mjs';
import { createBenchmarkSentinelPlaybooks, createBenchmarkSentinelDecisionDeck, createBenchmarkSentinelEscalationMoments } from './playbooks-benchmark-sentinel.mjs';

export function buildBenchmarkSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkSentinelWorkspace(workspaceName);
  const policies = createBenchmarkSentinelPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkSentinelWorkspace(workspace),
    narratives: createBenchmarkSentinelNarratives(workspace),
    coverage: createBenchmarkSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkSentinelPolicies(policies),
    validation: validateBenchmarkSentinelPolicies(policies),
    escalationDeck: createBenchmarkSentinelEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkSentinelAnalyticsTimeline(),
      forecast: createBenchmarkSentinelForecastEnvelope(),
      exceptions: createBenchmarkSentinelExceptionLedger(),
      summary: summarizeBenchmarkSentinelAnalytics()
    },
    operations: {
      board: createBenchmarkSentinelOperationsBoard(),
      checklist: createBenchmarkSentinelShiftChecklist(),
      incidents: createBenchmarkSentinelIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkSentinelReportCards(),
      packets: createBenchmarkSentinelReviewPackets(),
      summary: summarizeBenchmarkSentinelReporting()
    },
    audit: {
      trail: createBenchmarkSentinelAuditTrail(),
      manifest: createBenchmarkSentinelEvidenceManifest(),
      attestation: createBenchmarkSentinelReadinessAttestation()
    },
    playbooks: createBenchmarkSentinelPlaybooks(),
    decisions: createBenchmarkSentinelDecisionDeck(),
    escalationMoments: createBenchmarkSentinelEscalationMoments()
  };
}

export function createBenchmarkSentinelReadinessBoard(snapshot = buildBenchmarkSentinelSnapshot()) {
  return [
    { id: 'benchmark-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkSentinelApiDocument(snapshot = buildBenchmarkSentinelSnapshot()) {
  return {
    id: 'benchmark-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-sentinel/overview' },
      { method: 'GET', path: '/api/benchmark-sentinel/reporting' },
      { method: 'POST', path: '/api/benchmark-sentinel/validate' },
      { method: 'GET', path: '/api/benchmark-sentinel/audit' }
    ],
    readiness: createBenchmarkSentinelReadinessBoard(snapshot)
  };
}

export function createBenchmarkSentinelRouteSummary(snapshot = buildBenchmarkSentinelSnapshot()) {
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

