import { createCollaborationNotebookWorkspace, summarizeCollaborationNotebookWorkspace, createCollaborationNotebookNarratives, createCollaborationNotebookCoverageGrid } from './domain-collaboration-notebook.mjs';
import { createCollaborationNotebookPolicies, validateCollaborationNotebookPolicies, summarizeCollaborationNotebookPolicies, createCollaborationNotebookEscalationDeck } from './policies-collaboration-notebook.mjs';
import { createCollaborationNotebookAnalyticsTimeline, createCollaborationNotebookForecastEnvelope, createCollaborationNotebookExceptionLedger, summarizeCollaborationNotebookAnalytics } from './analytics-collaboration-notebook.mjs';
import { createCollaborationNotebookOperationsBoard, createCollaborationNotebookShiftChecklist, createCollaborationNotebookIncidentDeck } from './operations-collaboration-notebook.mjs';
import { createCollaborationNotebookReportCards, createCollaborationNotebookReviewPackets, summarizeCollaborationNotebookReporting } from './reporting-collaboration-notebook.mjs';
import { createCollaborationNotebookAuditTrail, createCollaborationNotebookEvidenceManifest, createCollaborationNotebookReadinessAttestation } from './audit-collaboration-notebook.mjs';
import { createCollaborationNotebookPlaybooks, createCollaborationNotebookDecisionDeck, createCollaborationNotebookEscalationMoments } from './playbooks-collaboration-notebook.mjs';

export function buildCollaborationNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationNotebookWorkspace(workspaceName);
  const policies = createCollaborationNotebookPolicies();
  return {
    workspace,
    summary: summarizeCollaborationNotebookWorkspace(workspace),
    narratives: createCollaborationNotebookNarratives(workspace),
    coverage: createCollaborationNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationNotebookPolicies(policies),
    validation: validateCollaborationNotebookPolicies(policies),
    escalationDeck: createCollaborationNotebookEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationNotebookAnalyticsTimeline(),
      forecast: createCollaborationNotebookForecastEnvelope(),
      exceptions: createCollaborationNotebookExceptionLedger(),
      summary: summarizeCollaborationNotebookAnalytics()
    },
    operations: {
      board: createCollaborationNotebookOperationsBoard(),
      checklist: createCollaborationNotebookShiftChecklist(),
      incidents: createCollaborationNotebookIncidentDeck()
    },
    reporting: {
      cards: createCollaborationNotebookReportCards(),
      packets: createCollaborationNotebookReviewPackets(),
      summary: summarizeCollaborationNotebookReporting()
    },
    audit: {
      trail: createCollaborationNotebookAuditTrail(),
      manifest: createCollaborationNotebookEvidenceManifest(),
      attestation: createCollaborationNotebookReadinessAttestation()
    },
    playbooks: createCollaborationNotebookPlaybooks(),
    decisions: createCollaborationNotebookDecisionDeck(),
    escalationMoments: createCollaborationNotebookEscalationMoments()
  };
}

export function createCollaborationNotebookReadinessBoard(snapshot = buildCollaborationNotebookSnapshot()) {
  return [
    { id: 'collaboration-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationNotebookApiDocument(snapshot = buildCollaborationNotebookSnapshot()) {
  return {
    id: 'collaboration-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-notebook/overview' },
      { method: 'GET', path: '/api/collaboration-notebook/reporting' },
      { method: 'POST', path: '/api/collaboration-notebook/validate' },
      { method: 'GET', path: '/api/collaboration-notebook/audit' }
    ],
    readiness: createCollaborationNotebookReadinessBoard(snapshot)
  };
}

export function createCollaborationNotebookRouteSummary(snapshot = buildCollaborationNotebookSnapshot()) {
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

