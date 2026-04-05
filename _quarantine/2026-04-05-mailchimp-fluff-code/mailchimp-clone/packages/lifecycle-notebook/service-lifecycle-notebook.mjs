import { createLifecycleNotebookWorkspace, summarizeLifecycleNotebookWorkspace, createLifecycleNotebookNarratives, createLifecycleNotebookCoverageGrid } from './domain-lifecycle-notebook.mjs';
import { createLifecycleNotebookPolicies, validateLifecycleNotebookPolicies, summarizeLifecycleNotebookPolicies, createLifecycleNotebookEscalationDeck } from './policies-lifecycle-notebook.mjs';
import { createLifecycleNotebookAnalyticsTimeline, createLifecycleNotebookForecastEnvelope, createLifecycleNotebookExceptionLedger, summarizeLifecycleNotebookAnalytics } from './analytics-lifecycle-notebook.mjs';
import { createLifecycleNotebookOperationsBoard, createLifecycleNotebookShiftChecklist, createLifecycleNotebookIncidentDeck } from './operations-lifecycle-notebook.mjs';
import { createLifecycleNotebookReportCards, createLifecycleNotebookReviewPackets, summarizeLifecycleNotebookReporting } from './reporting-lifecycle-notebook.mjs';
import { createLifecycleNotebookAuditTrail, createLifecycleNotebookEvidenceManifest, createLifecycleNotebookReadinessAttestation } from './audit-lifecycle-notebook.mjs';
import { createLifecycleNotebookPlaybooks, createLifecycleNotebookDecisionDeck, createLifecycleNotebookEscalationMoments } from './playbooks-lifecycle-notebook.mjs';

export function buildLifecycleNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleNotebookWorkspace(workspaceName);
  const policies = createLifecycleNotebookPolicies();
  return {
    workspace,
    summary: summarizeLifecycleNotebookWorkspace(workspace),
    narratives: createLifecycleNotebookNarratives(workspace),
    coverage: createLifecycleNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleNotebookPolicies(policies),
    validation: validateLifecycleNotebookPolicies(policies),
    escalationDeck: createLifecycleNotebookEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleNotebookAnalyticsTimeline(),
      forecast: createLifecycleNotebookForecastEnvelope(),
      exceptions: createLifecycleNotebookExceptionLedger(),
      summary: summarizeLifecycleNotebookAnalytics()
    },
    operations: {
      board: createLifecycleNotebookOperationsBoard(),
      checklist: createLifecycleNotebookShiftChecklist(),
      incidents: createLifecycleNotebookIncidentDeck()
    },
    reporting: {
      cards: createLifecycleNotebookReportCards(),
      packets: createLifecycleNotebookReviewPackets(),
      summary: summarizeLifecycleNotebookReporting()
    },
    audit: {
      trail: createLifecycleNotebookAuditTrail(),
      manifest: createLifecycleNotebookEvidenceManifest(),
      attestation: createLifecycleNotebookReadinessAttestation()
    },
    playbooks: createLifecycleNotebookPlaybooks(),
    decisions: createLifecycleNotebookDecisionDeck(),
    escalationMoments: createLifecycleNotebookEscalationMoments()
  };
}

export function createLifecycleNotebookReadinessBoard(snapshot = buildLifecycleNotebookSnapshot()) {
  return [
    { id: 'lifecycle-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleNotebookApiDocument(snapshot = buildLifecycleNotebookSnapshot()) {
  return {
    id: 'lifecycle-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-notebook/overview' },
      { method: 'GET', path: '/api/lifecycle-notebook/reporting' },
      { method: 'POST', path: '/api/lifecycle-notebook/validate' },
      { method: 'GET', path: '/api/lifecycle-notebook/audit' }
    ],
    readiness: createLifecycleNotebookReadinessBoard(snapshot)
  };
}

export function createLifecycleNotebookRouteSummary(snapshot = buildLifecycleNotebookSnapshot()) {
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

