import { createContentNotebookWorkspace, summarizeContentNotebookWorkspace, createContentNotebookNarratives, createContentNotebookCoverageGrid } from './domain-content-notebook.mjs';
import { createContentNotebookPolicies, validateContentNotebookPolicies, summarizeContentNotebookPolicies, createContentNotebookEscalationDeck } from './policies-content-notebook.mjs';
import { createContentNotebookAnalyticsTimeline, createContentNotebookForecastEnvelope, createContentNotebookExceptionLedger, summarizeContentNotebookAnalytics } from './analytics-content-notebook.mjs';
import { createContentNotebookOperationsBoard, createContentNotebookShiftChecklist, createContentNotebookIncidentDeck } from './operations-content-notebook.mjs';
import { createContentNotebookReportCards, createContentNotebookReviewPackets, summarizeContentNotebookReporting } from './reporting-content-notebook.mjs';
import { createContentNotebookAuditTrail, createContentNotebookEvidenceManifest, createContentNotebookReadinessAttestation } from './audit-content-notebook.mjs';
import { createContentNotebookPlaybooks, createContentNotebookDecisionDeck, createContentNotebookEscalationMoments } from './playbooks-content-notebook.mjs';

export function buildContentNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentNotebookWorkspace(workspaceName);
  const policies = createContentNotebookPolicies();
  return {
    workspace,
    summary: summarizeContentNotebookWorkspace(workspace),
    narratives: createContentNotebookNarratives(workspace),
    coverage: createContentNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentNotebookPolicies(policies),
    validation: validateContentNotebookPolicies(policies),
    escalationDeck: createContentNotebookEscalationDeck(policies),
    analytics: {
      timeline: createContentNotebookAnalyticsTimeline(),
      forecast: createContentNotebookForecastEnvelope(),
      exceptions: createContentNotebookExceptionLedger(),
      summary: summarizeContentNotebookAnalytics()
    },
    operations: {
      board: createContentNotebookOperationsBoard(),
      checklist: createContentNotebookShiftChecklist(),
      incidents: createContentNotebookIncidentDeck()
    },
    reporting: {
      cards: createContentNotebookReportCards(),
      packets: createContentNotebookReviewPackets(),
      summary: summarizeContentNotebookReporting()
    },
    audit: {
      trail: createContentNotebookAuditTrail(),
      manifest: createContentNotebookEvidenceManifest(),
      attestation: createContentNotebookReadinessAttestation()
    },
    playbooks: createContentNotebookPlaybooks(),
    decisions: createContentNotebookDecisionDeck(),
    escalationMoments: createContentNotebookEscalationMoments()
  };
}

export function createContentNotebookReadinessBoard(snapshot = buildContentNotebookSnapshot()) {
  return [
    { id: 'content-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentNotebookApiDocument(snapshot = buildContentNotebookSnapshot()) {
  return {
    id: 'content-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-notebook/overview' },
      { method: 'GET', path: '/api/content-notebook/reporting' },
      { method: 'POST', path: '/api/content-notebook/validate' },
      { method: 'GET', path: '/api/content-notebook/audit' }
    ],
    readiness: createContentNotebookReadinessBoard(snapshot)
  };
}

export function createContentNotebookRouteSummary(snapshot = buildContentNotebookSnapshot()) {
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

