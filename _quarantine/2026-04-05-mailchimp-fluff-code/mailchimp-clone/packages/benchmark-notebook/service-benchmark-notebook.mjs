import { createBenchmarkNotebookWorkspace, summarizeBenchmarkNotebookWorkspace, createBenchmarkNotebookNarratives, createBenchmarkNotebookCoverageGrid } from './domain-benchmark-notebook.mjs';
import { createBenchmarkNotebookPolicies, validateBenchmarkNotebookPolicies, summarizeBenchmarkNotebookPolicies, createBenchmarkNotebookEscalationDeck } from './policies-benchmark-notebook.mjs';
import { createBenchmarkNotebookAnalyticsTimeline, createBenchmarkNotebookForecastEnvelope, createBenchmarkNotebookExceptionLedger, summarizeBenchmarkNotebookAnalytics } from './analytics-benchmark-notebook.mjs';
import { createBenchmarkNotebookOperationsBoard, createBenchmarkNotebookShiftChecklist, createBenchmarkNotebookIncidentDeck } from './operations-benchmark-notebook.mjs';
import { createBenchmarkNotebookReportCards, createBenchmarkNotebookReviewPackets, summarizeBenchmarkNotebookReporting } from './reporting-benchmark-notebook.mjs';
import { createBenchmarkNotebookAuditTrail, createBenchmarkNotebookEvidenceManifest, createBenchmarkNotebookReadinessAttestation } from './audit-benchmark-notebook.mjs';
import { createBenchmarkNotebookPlaybooks, createBenchmarkNotebookDecisionDeck, createBenchmarkNotebookEscalationMoments } from './playbooks-benchmark-notebook.mjs';

export function buildBenchmarkNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkNotebookWorkspace(workspaceName);
  const policies = createBenchmarkNotebookPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkNotebookWorkspace(workspace),
    narratives: createBenchmarkNotebookNarratives(workspace),
    coverage: createBenchmarkNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkNotebookPolicies(policies),
    validation: validateBenchmarkNotebookPolicies(policies),
    escalationDeck: createBenchmarkNotebookEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkNotebookAnalyticsTimeline(),
      forecast: createBenchmarkNotebookForecastEnvelope(),
      exceptions: createBenchmarkNotebookExceptionLedger(),
      summary: summarizeBenchmarkNotebookAnalytics()
    },
    operations: {
      board: createBenchmarkNotebookOperationsBoard(),
      checklist: createBenchmarkNotebookShiftChecklist(),
      incidents: createBenchmarkNotebookIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkNotebookReportCards(),
      packets: createBenchmarkNotebookReviewPackets(),
      summary: summarizeBenchmarkNotebookReporting()
    },
    audit: {
      trail: createBenchmarkNotebookAuditTrail(),
      manifest: createBenchmarkNotebookEvidenceManifest(),
      attestation: createBenchmarkNotebookReadinessAttestation()
    },
    playbooks: createBenchmarkNotebookPlaybooks(),
    decisions: createBenchmarkNotebookDecisionDeck(),
    escalationMoments: createBenchmarkNotebookEscalationMoments()
  };
}

export function createBenchmarkNotebookReadinessBoard(snapshot = buildBenchmarkNotebookSnapshot()) {
  return [
    { id: 'benchmark-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkNotebookApiDocument(snapshot = buildBenchmarkNotebookSnapshot()) {
  return {
    id: 'benchmark-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-notebook/overview' },
      { method: 'GET', path: '/api/benchmark-notebook/reporting' },
      { method: 'POST', path: '/api/benchmark-notebook/validate' },
      { method: 'GET', path: '/api/benchmark-notebook/audit' }
    ],
    readiness: createBenchmarkNotebookReadinessBoard(snapshot)
  };
}

export function createBenchmarkNotebookRouteSummary(snapshot = buildBenchmarkNotebookSnapshot()) {
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

