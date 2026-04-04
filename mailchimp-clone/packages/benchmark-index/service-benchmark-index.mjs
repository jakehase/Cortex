import { createBenchmarkIndexWorkspace, summarizeBenchmarkIndexWorkspace, createBenchmarkIndexNarratives, createBenchmarkIndexCoverageGrid } from './domain-benchmark-index.mjs';
import { createBenchmarkIndexPolicies, validateBenchmarkIndexPolicies, summarizeBenchmarkIndexPolicies, createBenchmarkIndexEscalationDeck } from './policies-benchmark-index.mjs';
import { createBenchmarkIndexAnalyticsTimeline, createBenchmarkIndexForecastEnvelope, createBenchmarkIndexExceptionLedger, summarizeBenchmarkIndexAnalytics } from './analytics-benchmark-index.mjs';
import { createBenchmarkIndexOperationsBoard, createBenchmarkIndexShiftChecklist, createBenchmarkIndexIncidentDeck } from './operations-benchmark-index.mjs';
import { createBenchmarkIndexReportCards, createBenchmarkIndexReviewPackets, summarizeBenchmarkIndexReporting } from './reporting-benchmark-index.mjs';
import { createBenchmarkIndexAuditTrail, createBenchmarkIndexEvidenceManifest, createBenchmarkIndexReadinessAttestation } from './audit-benchmark-index.mjs';
import { createBenchmarkIndexPlaybooks, createBenchmarkIndexDecisionDeck, createBenchmarkIndexEscalationMoments } from './playbooks-benchmark-index.mjs';

export function buildBenchmarkIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkIndexWorkspace(workspaceName);
  const policies = createBenchmarkIndexPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkIndexWorkspace(workspace),
    narratives: createBenchmarkIndexNarratives(workspace),
    coverage: createBenchmarkIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkIndexPolicies(policies),
    validation: validateBenchmarkIndexPolicies(policies),
    escalationDeck: createBenchmarkIndexEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkIndexAnalyticsTimeline(),
      forecast: createBenchmarkIndexForecastEnvelope(),
      exceptions: createBenchmarkIndexExceptionLedger(),
      summary: summarizeBenchmarkIndexAnalytics()
    },
    operations: {
      board: createBenchmarkIndexOperationsBoard(),
      checklist: createBenchmarkIndexShiftChecklist(),
      incidents: createBenchmarkIndexIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkIndexReportCards(),
      packets: createBenchmarkIndexReviewPackets(),
      summary: summarizeBenchmarkIndexReporting()
    },
    audit: {
      trail: createBenchmarkIndexAuditTrail(),
      manifest: createBenchmarkIndexEvidenceManifest(),
      attestation: createBenchmarkIndexReadinessAttestation()
    },
    playbooks: createBenchmarkIndexPlaybooks(),
    decisions: createBenchmarkIndexDecisionDeck(),
    escalationMoments: createBenchmarkIndexEscalationMoments()
  };
}

export function createBenchmarkIndexReadinessBoard(snapshot = buildBenchmarkIndexSnapshot()) {
  return [
    { id: 'benchmark-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkIndexApiDocument(snapshot = buildBenchmarkIndexSnapshot()) {
  return {
    id: 'benchmark-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-index/overview' },
      { method: 'GET', path: '/api/benchmark-index/reporting' },
      { method: 'POST', path: '/api/benchmark-index/validate' },
      { method: 'GET', path: '/api/benchmark-index/audit' }
    ],
    readiness: createBenchmarkIndexReadinessBoard(snapshot)
  };
}

export function createBenchmarkIndexRouteSummary(snapshot = buildBenchmarkIndexSnapshot()) {
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

