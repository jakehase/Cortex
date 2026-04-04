import { createBenchmarkPlannerWorkspace, summarizeBenchmarkPlannerWorkspace, createBenchmarkPlannerNarratives, createBenchmarkPlannerCoverageGrid } from './domain-benchmark-planner.mjs';
import { createBenchmarkPlannerPolicies, validateBenchmarkPlannerPolicies, summarizeBenchmarkPlannerPolicies, createBenchmarkPlannerEscalationDeck } from './policies-benchmark-planner.mjs';
import { createBenchmarkPlannerAnalyticsTimeline, createBenchmarkPlannerForecastEnvelope, createBenchmarkPlannerExceptionLedger, summarizeBenchmarkPlannerAnalytics } from './analytics-benchmark-planner.mjs';
import { createBenchmarkPlannerOperationsBoard, createBenchmarkPlannerShiftChecklist, createBenchmarkPlannerIncidentDeck } from './operations-benchmark-planner.mjs';
import { createBenchmarkPlannerReportCards, createBenchmarkPlannerReviewPackets, summarizeBenchmarkPlannerReporting } from './reporting-benchmark-planner.mjs';
import { createBenchmarkPlannerAuditTrail, createBenchmarkPlannerEvidenceManifest, createBenchmarkPlannerReadinessAttestation } from './audit-benchmark-planner.mjs';
import { createBenchmarkPlannerPlaybooks, createBenchmarkPlannerDecisionDeck, createBenchmarkPlannerEscalationMoments } from './playbooks-benchmark-planner.mjs';

export function buildBenchmarkPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkPlannerWorkspace(workspaceName);
  const policies = createBenchmarkPlannerPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkPlannerWorkspace(workspace),
    narratives: createBenchmarkPlannerNarratives(workspace),
    coverage: createBenchmarkPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkPlannerPolicies(policies),
    validation: validateBenchmarkPlannerPolicies(policies),
    escalationDeck: createBenchmarkPlannerEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkPlannerAnalyticsTimeline(),
      forecast: createBenchmarkPlannerForecastEnvelope(),
      exceptions: createBenchmarkPlannerExceptionLedger(),
      summary: summarizeBenchmarkPlannerAnalytics()
    },
    operations: {
      board: createBenchmarkPlannerOperationsBoard(),
      checklist: createBenchmarkPlannerShiftChecklist(),
      incidents: createBenchmarkPlannerIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkPlannerReportCards(),
      packets: createBenchmarkPlannerReviewPackets(),
      summary: summarizeBenchmarkPlannerReporting()
    },
    audit: {
      trail: createBenchmarkPlannerAuditTrail(),
      manifest: createBenchmarkPlannerEvidenceManifest(),
      attestation: createBenchmarkPlannerReadinessAttestation()
    },
    playbooks: createBenchmarkPlannerPlaybooks(),
    decisions: createBenchmarkPlannerDecisionDeck(),
    escalationMoments: createBenchmarkPlannerEscalationMoments()
  };
}

export function createBenchmarkPlannerReadinessBoard(snapshot = buildBenchmarkPlannerSnapshot()) {
  return [
    { id: 'benchmark-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkPlannerApiDocument(snapshot = buildBenchmarkPlannerSnapshot()) {
  return {
    id: 'benchmark-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-planner/overview' },
      { method: 'GET', path: '/api/benchmark-planner/reporting' },
      { method: 'POST', path: '/api/benchmark-planner/validate' },
      { method: 'GET', path: '/api/benchmark-planner/audit' }
    ],
    readiness: createBenchmarkPlannerReadinessBoard(snapshot)
  };
}

export function createBenchmarkPlannerRouteSummary(snapshot = buildBenchmarkPlannerSnapshot()) {
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

