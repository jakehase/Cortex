import { createBenchmarkHubWorkspace, summarizeBenchmarkHubWorkspace, createBenchmarkHubNarratives, createBenchmarkHubCoverageGrid } from './domain-benchmark-hub.mjs';
import { createBenchmarkHubPolicies, validateBenchmarkHubPolicies, summarizeBenchmarkHubPolicies, createBenchmarkHubEscalationDeck } from './policies-benchmark-hub.mjs';
import { createBenchmarkHubAnalyticsTimeline, createBenchmarkHubForecastEnvelope, createBenchmarkHubExceptionLedger, summarizeBenchmarkHubAnalytics } from './analytics-benchmark-hub.mjs';
import { createBenchmarkHubOperationsBoard, createBenchmarkHubShiftChecklist, createBenchmarkHubIncidentDeck } from './operations-benchmark-hub.mjs';
import { createBenchmarkHubReportCards, createBenchmarkHubReviewPackets, summarizeBenchmarkHubReporting } from './reporting-benchmark-hub.mjs';
import { createBenchmarkHubAuditTrail, createBenchmarkHubEvidenceManifest, createBenchmarkHubReadinessAttestation } from './audit-benchmark-hub.mjs';
import { createBenchmarkHubPlaybooks, createBenchmarkHubDecisionDeck, createBenchmarkHubEscalationMoments } from './playbooks-benchmark-hub.mjs';

export function buildBenchmarkHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkHubWorkspace(workspaceName);
  const policies = createBenchmarkHubPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkHubWorkspace(workspace),
    narratives: createBenchmarkHubNarratives(workspace),
    coverage: createBenchmarkHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkHubPolicies(policies),
    validation: validateBenchmarkHubPolicies(policies),
    escalationDeck: createBenchmarkHubEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkHubAnalyticsTimeline(),
      forecast: createBenchmarkHubForecastEnvelope(),
      exceptions: createBenchmarkHubExceptionLedger(),
      summary: summarizeBenchmarkHubAnalytics()
    },
    operations: {
      board: createBenchmarkHubOperationsBoard(),
      checklist: createBenchmarkHubShiftChecklist(),
      incidents: createBenchmarkHubIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkHubReportCards(),
      packets: createBenchmarkHubReviewPackets(),
      summary: summarizeBenchmarkHubReporting()
    },
    audit: {
      trail: createBenchmarkHubAuditTrail(),
      manifest: createBenchmarkHubEvidenceManifest(),
      attestation: createBenchmarkHubReadinessAttestation()
    },
    playbooks: createBenchmarkHubPlaybooks(),
    decisions: createBenchmarkHubDecisionDeck(),
    escalationMoments: createBenchmarkHubEscalationMoments()
  };
}

export function createBenchmarkHubReadinessBoard(snapshot = buildBenchmarkHubSnapshot()) {
  return [
    { id: 'benchmark-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkHubApiDocument(snapshot = buildBenchmarkHubSnapshot()) {
  return {
    id: 'benchmark-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-hub/overview' },
      { method: 'GET', path: '/api/benchmark-hub/reporting' },
      { method: 'POST', path: '/api/benchmark-hub/validate' },
      { method: 'GET', path: '/api/benchmark-hub/audit' }
    ],
    readiness: createBenchmarkHubReadinessBoard(snapshot)
  };
}

export function createBenchmarkHubRouteSummary(snapshot = buildBenchmarkHubSnapshot()) {
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

