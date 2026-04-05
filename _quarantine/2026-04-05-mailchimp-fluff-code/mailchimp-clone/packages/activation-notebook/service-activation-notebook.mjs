import { createActivationNotebookWorkspace, summarizeActivationNotebookWorkspace, createActivationNotebookNarratives, createActivationNotebookCoverageGrid } from './domain-activation-notebook.mjs';
import { createActivationNotebookPolicies, validateActivationNotebookPolicies, summarizeActivationNotebookPolicies, createActivationNotebookEscalationDeck } from './policies-activation-notebook.mjs';
import { createActivationNotebookAnalyticsTimeline, createActivationNotebookForecastEnvelope, createActivationNotebookExceptionLedger, summarizeActivationNotebookAnalytics } from './analytics-activation-notebook.mjs';
import { createActivationNotebookOperationsBoard, createActivationNotebookShiftChecklist, createActivationNotebookIncidentDeck } from './operations-activation-notebook.mjs';
import { createActivationNotebookReportCards, createActivationNotebookReviewPackets, summarizeActivationNotebookReporting } from './reporting-activation-notebook.mjs';
import { createActivationNotebookAuditTrail, createActivationNotebookEvidenceManifest, createActivationNotebookReadinessAttestation } from './audit-activation-notebook.mjs';
import { createActivationNotebookPlaybooks, createActivationNotebookDecisionDeck, createActivationNotebookEscalationMoments } from './playbooks-activation-notebook.mjs';

export function buildActivationNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationNotebookWorkspace(workspaceName);
  const policies = createActivationNotebookPolicies();
  return {
    workspace,
    summary: summarizeActivationNotebookWorkspace(workspace),
    narratives: createActivationNotebookNarratives(workspace),
    coverage: createActivationNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationNotebookPolicies(policies),
    validation: validateActivationNotebookPolicies(policies),
    escalationDeck: createActivationNotebookEscalationDeck(policies),
    analytics: {
      timeline: createActivationNotebookAnalyticsTimeline(),
      forecast: createActivationNotebookForecastEnvelope(),
      exceptions: createActivationNotebookExceptionLedger(),
      summary: summarizeActivationNotebookAnalytics()
    },
    operations: {
      board: createActivationNotebookOperationsBoard(),
      checklist: createActivationNotebookShiftChecklist(),
      incidents: createActivationNotebookIncidentDeck()
    },
    reporting: {
      cards: createActivationNotebookReportCards(),
      packets: createActivationNotebookReviewPackets(),
      summary: summarizeActivationNotebookReporting()
    },
    audit: {
      trail: createActivationNotebookAuditTrail(),
      manifest: createActivationNotebookEvidenceManifest(),
      attestation: createActivationNotebookReadinessAttestation()
    },
    playbooks: createActivationNotebookPlaybooks(),
    decisions: createActivationNotebookDecisionDeck(),
    escalationMoments: createActivationNotebookEscalationMoments()
  };
}

export function createActivationNotebookReadinessBoard(snapshot = buildActivationNotebookSnapshot()) {
  return [
    { id: 'activation-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationNotebookApiDocument(snapshot = buildActivationNotebookSnapshot()) {
  return {
    id: 'activation-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-notebook/overview' },
      { method: 'GET', path: '/api/activation-notebook/reporting' },
      { method: 'POST', path: '/api/activation-notebook/validate' },
      { method: 'GET', path: '/api/activation-notebook/audit' }
    ],
    readiness: createActivationNotebookReadinessBoard(snapshot)
  };
}

export function createActivationNotebookRouteSummary(snapshot = buildActivationNotebookSnapshot()) {
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

