import { createBenchmarkScorecardWorkspace, summarizeBenchmarkScorecardWorkspace, createBenchmarkScorecardNarratives, createBenchmarkScorecardCoverageGrid } from './domain-benchmark-scorecard.mjs';
import { createBenchmarkScorecardPolicies, validateBenchmarkScorecardPolicies, summarizeBenchmarkScorecardPolicies, createBenchmarkScorecardEscalationDeck } from './policies-benchmark-scorecard.mjs';
import { createBenchmarkScorecardAnalyticsTimeline, createBenchmarkScorecardForecastEnvelope, createBenchmarkScorecardExceptionLedger, summarizeBenchmarkScorecardAnalytics } from './analytics-benchmark-scorecard.mjs';
import { createBenchmarkScorecardOperationsBoard, createBenchmarkScorecardShiftChecklist, createBenchmarkScorecardIncidentDeck } from './operations-benchmark-scorecard.mjs';
import { createBenchmarkScorecardReportCards, createBenchmarkScorecardReviewPackets, summarizeBenchmarkScorecardReporting } from './reporting-benchmark-scorecard.mjs';
import { createBenchmarkScorecardAuditTrail, createBenchmarkScorecardEvidenceManifest, createBenchmarkScorecardReadinessAttestation } from './audit-benchmark-scorecard.mjs';
import { createBenchmarkScorecardPlaybooks, createBenchmarkScorecardDecisionDeck, createBenchmarkScorecardEscalationMoments } from './playbooks-benchmark-scorecard.mjs';

export function buildBenchmarkScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkScorecardWorkspace(workspaceName);
  const policies = createBenchmarkScorecardPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkScorecardWorkspace(workspace),
    narratives: createBenchmarkScorecardNarratives(workspace),
    coverage: createBenchmarkScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkScorecardPolicies(policies),
    validation: validateBenchmarkScorecardPolicies(policies),
    escalationDeck: createBenchmarkScorecardEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkScorecardAnalyticsTimeline(),
      forecast: createBenchmarkScorecardForecastEnvelope(),
      exceptions: createBenchmarkScorecardExceptionLedger(),
      summary: summarizeBenchmarkScorecardAnalytics()
    },
    operations: {
      board: createBenchmarkScorecardOperationsBoard(),
      checklist: createBenchmarkScorecardShiftChecklist(),
      incidents: createBenchmarkScorecardIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkScorecardReportCards(),
      packets: createBenchmarkScorecardReviewPackets(),
      summary: summarizeBenchmarkScorecardReporting()
    },
    audit: {
      trail: createBenchmarkScorecardAuditTrail(),
      manifest: createBenchmarkScorecardEvidenceManifest(),
      attestation: createBenchmarkScorecardReadinessAttestation()
    },
    playbooks: createBenchmarkScorecardPlaybooks(),
    decisions: createBenchmarkScorecardDecisionDeck(),
    escalationMoments: createBenchmarkScorecardEscalationMoments()
  };
}

export function createBenchmarkScorecardReadinessBoard(snapshot = buildBenchmarkScorecardSnapshot()) {
  return [
    { id: 'benchmark-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkScorecardApiDocument(snapshot = buildBenchmarkScorecardSnapshot()) {
  return {
    id: 'benchmark-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-scorecard/overview' },
      { method: 'GET', path: '/api/benchmark-scorecard/reporting' },
      { method: 'POST', path: '/api/benchmark-scorecard/validate' },
      { method: 'GET', path: '/api/benchmark-scorecard/audit' }
    ],
    readiness: createBenchmarkScorecardReadinessBoard(snapshot)
  };
}

export function createBenchmarkScorecardRouteSummary(snapshot = buildBenchmarkScorecardSnapshot()) {
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

