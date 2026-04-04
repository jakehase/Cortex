import { createBenchmarkWatchtowerWorkspace, summarizeBenchmarkWatchtowerWorkspace, createBenchmarkWatchtowerNarratives, createBenchmarkWatchtowerCoverageGrid } from './domain-benchmark-watchtower.mjs';
import { createBenchmarkWatchtowerPolicies, validateBenchmarkWatchtowerPolicies, summarizeBenchmarkWatchtowerPolicies, createBenchmarkWatchtowerEscalationDeck } from './policies-benchmark-watchtower.mjs';
import { createBenchmarkWatchtowerAnalyticsTimeline, createBenchmarkWatchtowerForecastEnvelope, createBenchmarkWatchtowerExceptionLedger, summarizeBenchmarkWatchtowerAnalytics } from './analytics-benchmark-watchtower.mjs';
import { createBenchmarkWatchtowerOperationsBoard, createBenchmarkWatchtowerShiftChecklist, createBenchmarkWatchtowerIncidentDeck } from './operations-benchmark-watchtower.mjs';
import { createBenchmarkWatchtowerReportCards, createBenchmarkWatchtowerReviewPackets, summarizeBenchmarkWatchtowerReporting } from './reporting-benchmark-watchtower.mjs';
import { createBenchmarkWatchtowerAuditTrail, createBenchmarkWatchtowerEvidenceManifest, createBenchmarkWatchtowerReadinessAttestation } from './audit-benchmark-watchtower.mjs';
import { createBenchmarkWatchtowerPlaybooks, createBenchmarkWatchtowerDecisionDeck, createBenchmarkWatchtowerEscalationMoments } from './playbooks-benchmark-watchtower.mjs';

export function buildBenchmarkWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkWatchtowerWorkspace(workspaceName);
  const policies = createBenchmarkWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkWatchtowerWorkspace(workspace),
    narratives: createBenchmarkWatchtowerNarratives(workspace),
    coverage: createBenchmarkWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkWatchtowerPolicies(policies),
    validation: validateBenchmarkWatchtowerPolicies(policies),
    escalationDeck: createBenchmarkWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkWatchtowerAnalyticsTimeline(),
      forecast: createBenchmarkWatchtowerForecastEnvelope(),
      exceptions: createBenchmarkWatchtowerExceptionLedger(),
      summary: summarizeBenchmarkWatchtowerAnalytics()
    },
    operations: {
      board: createBenchmarkWatchtowerOperationsBoard(),
      checklist: createBenchmarkWatchtowerShiftChecklist(),
      incidents: createBenchmarkWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkWatchtowerReportCards(),
      packets: createBenchmarkWatchtowerReviewPackets(),
      summary: summarizeBenchmarkWatchtowerReporting()
    },
    audit: {
      trail: createBenchmarkWatchtowerAuditTrail(),
      manifest: createBenchmarkWatchtowerEvidenceManifest(),
      attestation: createBenchmarkWatchtowerReadinessAttestation()
    },
    playbooks: createBenchmarkWatchtowerPlaybooks(),
    decisions: createBenchmarkWatchtowerDecisionDeck(),
    escalationMoments: createBenchmarkWatchtowerEscalationMoments()
  };
}

export function createBenchmarkWatchtowerReadinessBoard(snapshot = buildBenchmarkWatchtowerSnapshot()) {
  return [
    { id: 'benchmark-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkWatchtowerApiDocument(snapshot = buildBenchmarkWatchtowerSnapshot()) {
  return {
    id: 'benchmark-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-watchtower/overview' },
      { method: 'GET', path: '/api/benchmark-watchtower/reporting' },
      { method: 'POST', path: '/api/benchmark-watchtower/validate' },
      { method: 'GET', path: '/api/benchmark-watchtower/audit' }
    ],
    readiness: createBenchmarkWatchtowerReadinessBoard(snapshot)
  };
}

export function createBenchmarkWatchtowerRouteSummary(snapshot = buildBenchmarkWatchtowerSnapshot()) {
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

