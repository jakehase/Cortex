import { createCreativeNotebookWorkspace, summarizeCreativeNotebookWorkspace, createCreativeNotebookNarratives, createCreativeNotebookCoverageGrid } from './domain-creative-notebook.mjs';
import { createCreativeNotebookPolicies, validateCreativeNotebookPolicies, summarizeCreativeNotebookPolicies, createCreativeNotebookEscalationDeck } from './policies-creative-notebook.mjs';
import { createCreativeNotebookAnalyticsTimeline, createCreativeNotebookForecastEnvelope, createCreativeNotebookExceptionLedger, summarizeCreativeNotebookAnalytics } from './analytics-creative-notebook.mjs';
import { createCreativeNotebookOperationsBoard, createCreativeNotebookShiftChecklist, createCreativeNotebookIncidentDeck } from './operations-creative-notebook.mjs';
import { createCreativeNotebookReportCards, createCreativeNotebookReviewPackets, summarizeCreativeNotebookReporting } from './reporting-creative-notebook.mjs';
import { createCreativeNotebookAuditTrail, createCreativeNotebookEvidenceManifest, createCreativeNotebookReadinessAttestation } from './audit-creative-notebook.mjs';
import { createCreativeNotebookPlaybooks, createCreativeNotebookDecisionDeck, createCreativeNotebookEscalationMoments } from './playbooks-creative-notebook.mjs';

export function buildCreativeNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeNotebookWorkspace(workspaceName);
  const policies = createCreativeNotebookPolicies();
  return {
    workspace,
    summary: summarizeCreativeNotebookWorkspace(workspace),
    narratives: createCreativeNotebookNarratives(workspace),
    coverage: createCreativeNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeNotebookPolicies(policies),
    validation: validateCreativeNotebookPolicies(policies),
    escalationDeck: createCreativeNotebookEscalationDeck(policies),
    analytics: {
      timeline: createCreativeNotebookAnalyticsTimeline(),
      forecast: createCreativeNotebookForecastEnvelope(),
      exceptions: createCreativeNotebookExceptionLedger(),
      summary: summarizeCreativeNotebookAnalytics()
    },
    operations: {
      board: createCreativeNotebookOperationsBoard(),
      checklist: createCreativeNotebookShiftChecklist(),
      incidents: createCreativeNotebookIncidentDeck()
    },
    reporting: {
      cards: createCreativeNotebookReportCards(),
      packets: createCreativeNotebookReviewPackets(),
      summary: summarizeCreativeNotebookReporting()
    },
    audit: {
      trail: createCreativeNotebookAuditTrail(),
      manifest: createCreativeNotebookEvidenceManifest(),
      attestation: createCreativeNotebookReadinessAttestation()
    },
    playbooks: createCreativeNotebookPlaybooks(),
    decisions: createCreativeNotebookDecisionDeck(),
    escalationMoments: createCreativeNotebookEscalationMoments()
  };
}

export function createCreativeNotebookReadinessBoard(snapshot = buildCreativeNotebookSnapshot()) {
  return [
    { id: 'creative-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeNotebookApiDocument(snapshot = buildCreativeNotebookSnapshot()) {
  return {
    id: 'creative-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-notebook/overview' },
      { method: 'GET', path: '/api/creative-notebook/reporting' },
      { method: 'POST', path: '/api/creative-notebook/validate' },
      { method: 'GET', path: '/api/creative-notebook/audit' }
    ],
    readiness: createCreativeNotebookReadinessBoard(snapshot)
  };
}

export function createCreativeNotebookRouteSummary(snapshot = buildCreativeNotebookSnapshot()) {
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

