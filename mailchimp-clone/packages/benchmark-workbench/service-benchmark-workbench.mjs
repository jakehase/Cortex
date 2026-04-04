import { createBenchmarkWorkbenchWorkspace, summarizeBenchmarkWorkbenchWorkspace, createBenchmarkWorkbenchNarratives, createBenchmarkWorkbenchCoverageGrid } from './domain-benchmark-workbench.mjs';
import { createBenchmarkWorkbenchPolicies, validateBenchmarkWorkbenchPolicies, summarizeBenchmarkWorkbenchPolicies, createBenchmarkWorkbenchEscalationDeck } from './policies-benchmark-workbench.mjs';
import { createBenchmarkWorkbenchAnalyticsTimeline, createBenchmarkWorkbenchForecastEnvelope, createBenchmarkWorkbenchExceptionLedger, summarizeBenchmarkWorkbenchAnalytics } from './analytics-benchmark-workbench.mjs';
import { createBenchmarkWorkbenchOperationsBoard, createBenchmarkWorkbenchShiftChecklist, createBenchmarkWorkbenchIncidentDeck } from './operations-benchmark-workbench.mjs';
import { createBenchmarkWorkbenchReportCards, createBenchmarkWorkbenchReviewPackets, summarizeBenchmarkWorkbenchReporting } from './reporting-benchmark-workbench.mjs';
import { createBenchmarkWorkbenchAuditTrail, createBenchmarkWorkbenchEvidenceManifest, createBenchmarkWorkbenchReadinessAttestation } from './audit-benchmark-workbench.mjs';
import { createBenchmarkWorkbenchPlaybooks, createBenchmarkWorkbenchDecisionDeck, createBenchmarkWorkbenchEscalationMoments } from './playbooks-benchmark-workbench.mjs';

export function buildBenchmarkWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkWorkbenchWorkspace(workspaceName);
  const policies = createBenchmarkWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkWorkbenchWorkspace(workspace),
    narratives: createBenchmarkWorkbenchNarratives(workspace),
    coverage: createBenchmarkWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkWorkbenchPolicies(policies),
    validation: validateBenchmarkWorkbenchPolicies(policies),
    escalationDeck: createBenchmarkWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkWorkbenchAnalyticsTimeline(),
      forecast: createBenchmarkWorkbenchForecastEnvelope(),
      exceptions: createBenchmarkWorkbenchExceptionLedger(),
      summary: summarizeBenchmarkWorkbenchAnalytics()
    },
    operations: {
      board: createBenchmarkWorkbenchOperationsBoard(),
      checklist: createBenchmarkWorkbenchShiftChecklist(),
      incidents: createBenchmarkWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkWorkbenchReportCards(),
      packets: createBenchmarkWorkbenchReviewPackets(),
      summary: summarizeBenchmarkWorkbenchReporting()
    },
    audit: {
      trail: createBenchmarkWorkbenchAuditTrail(),
      manifest: createBenchmarkWorkbenchEvidenceManifest(),
      attestation: createBenchmarkWorkbenchReadinessAttestation()
    },
    playbooks: createBenchmarkWorkbenchPlaybooks(),
    decisions: createBenchmarkWorkbenchDecisionDeck(),
    escalationMoments: createBenchmarkWorkbenchEscalationMoments()
  };
}

export function createBenchmarkWorkbenchReadinessBoard(snapshot = buildBenchmarkWorkbenchSnapshot()) {
  return [
    { id: 'benchmark-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkWorkbenchApiDocument(snapshot = buildBenchmarkWorkbenchSnapshot()) {
  return {
    id: 'benchmark-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-workbench/overview' },
      { method: 'GET', path: '/api/benchmark-workbench/reporting' },
      { method: 'POST', path: '/api/benchmark-workbench/validate' },
      { method: 'GET', path: '/api/benchmark-workbench/audit' }
    ],
    readiness: createBenchmarkWorkbenchReadinessBoard(snapshot)
  };
}

export function createBenchmarkWorkbenchRouteSummary(snapshot = buildBenchmarkWorkbenchSnapshot()) {
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

