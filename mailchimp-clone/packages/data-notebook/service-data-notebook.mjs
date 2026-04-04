import { createDataNotebookWorkspace, summarizeDataNotebookWorkspace, createDataNotebookNarratives, createDataNotebookCoverageGrid } from './domain-data-notebook.mjs';
import { createDataNotebookPolicies, validateDataNotebookPolicies, summarizeDataNotebookPolicies, createDataNotebookEscalationDeck } from './policies-data-notebook.mjs';
import { createDataNotebookAnalyticsTimeline, createDataNotebookForecastEnvelope, createDataNotebookExceptionLedger, summarizeDataNotebookAnalytics } from './analytics-data-notebook.mjs';
import { createDataNotebookOperationsBoard, createDataNotebookShiftChecklist, createDataNotebookIncidentDeck } from './operations-data-notebook.mjs';
import { createDataNotebookReportCards, createDataNotebookReviewPackets, summarizeDataNotebookReporting } from './reporting-data-notebook.mjs';
import { createDataNotebookAuditTrail, createDataNotebookEvidenceManifest, createDataNotebookReadinessAttestation } from './audit-data-notebook.mjs';
import { createDataNotebookPlaybooks, createDataNotebookDecisionDeck, createDataNotebookEscalationMoments } from './playbooks-data-notebook.mjs';

export function buildDataNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataNotebookWorkspace(workspaceName);
  const policies = createDataNotebookPolicies();
  return {
    workspace,
    summary: summarizeDataNotebookWorkspace(workspace),
    narratives: createDataNotebookNarratives(workspace),
    coverage: createDataNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataNotebookPolicies(policies),
    validation: validateDataNotebookPolicies(policies),
    escalationDeck: createDataNotebookEscalationDeck(policies),
    analytics: {
      timeline: createDataNotebookAnalyticsTimeline(),
      forecast: createDataNotebookForecastEnvelope(),
      exceptions: createDataNotebookExceptionLedger(),
      summary: summarizeDataNotebookAnalytics()
    },
    operations: {
      board: createDataNotebookOperationsBoard(),
      checklist: createDataNotebookShiftChecklist(),
      incidents: createDataNotebookIncidentDeck()
    },
    reporting: {
      cards: createDataNotebookReportCards(),
      packets: createDataNotebookReviewPackets(),
      summary: summarizeDataNotebookReporting()
    },
    audit: {
      trail: createDataNotebookAuditTrail(),
      manifest: createDataNotebookEvidenceManifest(),
      attestation: createDataNotebookReadinessAttestation()
    },
    playbooks: createDataNotebookPlaybooks(),
    decisions: createDataNotebookDecisionDeck(),
    escalationMoments: createDataNotebookEscalationMoments()
  };
}

export function createDataNotebookReadinessBoard(snapshot = buildDataNotebookSnapshot()) {
  return [
    { id: 'data-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataNotebookApiDocument(snapshot = buildDataNotebookSnapshot()) {
  return {
    id: 'data-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-notebook/overview' },
      { method: 'GET', path: '/api/data-notebook/reporting' },
      { method: 'POST', path: '/api/data-notebook/validate' },
      { method: 'GET', path: '/api/data-notebook/audit' }
    ],
    readiness: createDataNotebookReadinessBoard(snapshot)
  };
}

export function createDataNotebookRouteSummary(snapshot = buildDataNotebookSnapshot()) {
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

