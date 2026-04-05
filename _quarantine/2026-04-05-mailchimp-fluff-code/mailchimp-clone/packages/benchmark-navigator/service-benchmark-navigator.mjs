import { createBenchmarkNavigatorWorkspace, summarizeBenchmarkNavigatorWorkspace, createBenchmarkNavigatorNarratives, createBenchmarkNavigatorCoverageGrid } from './domain-benchmark-navigator.mjs';
import { createBenchmarkNavigatorPolicies, validateBenchmarkNavigatorPolicies, summarizeBenchmarkNavigatorPolicies, createBenchmarkNavigatorEscalationDeck } from './policies-benchmark-navigator.mjs';
import { createBenchmarkNavigatorAnalyticsTimeline, createBenchmarkNavigatorForecastEnvelope, createBenchmarkNavigatorExceptionLedger, summarizeBenchmarkNavigatorAnalytics } from './analytics-benchmark-navigator.mjs';
import { createBenchmarkNavigatorOperationsBoard, createBenchmarkNavigatorShiftChecklist, createBenchmarkNavigatorIncidentDeck } from './operations-benchmark-navigator.mjs';
import { createBenchmarkNavigatorReportCards, createBenchmarkNavigatorReviewPackets, summarizeBenchmarkNavigatorReporting } from './reporting-benchmark-navigator.mjs';
import { createBenchmarkNavigatorAuditTrail, createBenchmarkNavigatorEvidenceManifest, createBenchmarkNavigatorReadinessAttestation } from './audit-benchmark-navigator.mjs';
import { createBenchmarkNavigatorPlaybooks, createBenchmarkNavigatorDecisionDeck, createBenchmarkNavigatorEscalationMoments } from './playbooks-benchmark-navigator.mjs';

export function buildBenchmarkNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkNavigatorWorkspace(workspaceName);
  const policies = createBenchmarkNavigatorPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkNavigatorWorkspace(workspace),
    narratives: createBenchmarkNavigatorNarratives(workspace),
    coverage: createBenchmarkNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkNavigatorPolicies(policies),
    validation: validateBenchmarkNavigatorPolicies(policies),
    escalationDeck: createBenchmarkNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkNavigatorAnalyticsTimeline(),
      forecast: createBenchmarkNavigatorForecastEnvelope(),
      exceptions: createBenchmarkNavigatorExceptionLedger(),
      summary: summarizeBenchmarkNavigatorAnalytics()
    },
    operations: {
      board: createBenchmarkNavigatorOperationsBoard(),
      checklist: createBenchmarkNavigatorShiftChecklist(),
      incidents: createBenchmarkNavigatorIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkNavigatorReportCards(),
      packets: createBenchmarkNavigatorReviewPackets(),
      summary: summarizeBenchmarkNavigatorReporting()
    },
    audit: {
      trail: createBenchmarkNavigatorAuditTrail(),
      manifest: createBenchmarkNavigatorEvidenceManifest(),
      attestation: createBenchmarkNavigatorReadinessAttestation()
    },
    playbooks: createBenchmarkNavigatorPlaybooks(),
    decisions: createBenchmarkNavigatorDecisionDeck(),
    escalationMoments: createBenchmarkNavigatorEscalationMoments()
  };
}

export function createBenchmarkNavigatorReadinessBoard(snapshot = buildBenchmarkNavigatorSnapshot()) {
  return [
    { id: 'benchmark-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkNavigatorApiDocument(snapshot = buildBenchmarkNavigatorSnapshot()) {
  return {
    id: 'benchmark-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-navigator/overview' },
      { method: 'GET', path: '/api/benchmark-navigator/reporting' },
      { method: 'POST', path: '/api/benchmark-navigator/validate' },
      { method: 'GET', path: '/api/benchmark-navigator/audit' }
    ],
    readiness: createBenchmarkNavigatorReadinessBoard(snapshot)
  };
}

export function createBenchmarkNavigatorRouteSummary(snapshot = buildBenchmarkNavigatorSnapshot()) {
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

