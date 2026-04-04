import { createBenchmarkGridWorkspace, summarizeBenchmarkGridWorkspace, createBenchmarkGridNarratives, createBenchmarkGridCoverageGrid } from './domain-benchmark-grid.mjs';
import { createBenchmarkGridPolicies, validateBenchmarkGridPolicies, summarizeBenchmarkGridPolicies, createBenchmarkGridEscalationDeck } from './policies-benchmark-grid.mjs';
import { createBenchmarkGridAnalyticsTimeline, createBenchmarkGridForecastEnvelope, createBenchmarkGridExceptionLedger, summarizeBenchmarkGridAnalytics } from './analytics-benchmark-grid.mjs';
import { createBenchmarkGridOperationsBoard, createBenchmarkGridShiftChecklist, createBenchmarkGridIncidentDeck } from './operations-benchmark-grid.mjs';
import { createBenchmarkGridReportCards, createBenchmarkGridReviewPackets, summarizeBenchmarkGridReporting } from './reporting-benchmark-grid.mjs';
import { createBenchmarkGridAuditTrail, createBenchmarkGridEvidenceManifest, createBenchmarkGridReadinessAttestation } from './audit-benchmark-grid.mjs';
import { createBenchmarkGridPlaybooks, createBenchmarkGridDecisionDeck, createBenchmarkGridEscalationMoments } from './playbooks-benchmark-grid.mjs';

export function buildBenchmarkGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkGridWorkspace(workspaceName);
  const policies = createBenchmarkGridPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkGridWorkspace(workspace),
    narratives: createBenchmarkGridNarratives(workspace),
    coverage: createBenchmarkGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkGridPolicies(policies),
    validation: validateBenchmarkGridPolicies(policies),
    escalationDeck: createBenchmarkGridEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkGridAnalyticsTimeline(),
      forecast: createBenchmarkGridForecastEnvelope(),
      exceptions: createBenchmarkGridExceptionLedger(),
      summary: summarizeBenchmarkGridAnalytics()
    },
    operations: {
      board: createBenchmarkGridOperationsBoard(),
      checklist: createBenchmarkGridShiftChecklist(),
      incidents: createBenchmarkGridIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkGridReportCards(),
      packets: createBenchmarkGridReviewPackets(),
      summary: summarizeBenchmarkGridReporting()
    },
    audit: {
      trail: createBenchmarkGridAuditTrail(),
      manifest: createBenchmarkGridEvidenceManifest(),
      attestation: createBenchmarkGridReadinessAttestation()
    },
    playbooks: createBenchmarkGridPlaybooks(),
    decisions: createBenchmarkGridDecisionDeck(),
    escalationMoments: createBenchmarkGridEscalationMoments()
  };
}

export function createBenchmarkGridReadinessBoard(snapshot = buildBenchmarkGridSnapshot()) {
  return [
    { id: 'benchmark-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkGridApiDocument(snapshot = buildBenchmarkGridSnapshot()) {
  return {
    id: 'benchmark-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-grid/overview' },
      { method: 'GET', path: '/api/benchmark-grid/reporting' },
      { method: 'POST', path: '/api/benchmark-grid/validate' },
      { method: 'GET', path: '/api/benchmark-grid/audit' }
    ],
    readiness: createBenchmarkGridReadinessBoard(snapshot)
  };
}

export function createBenchmarkGridRouteSummary(snapshot = buildBenchmarkGridSnapshot()) {
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

