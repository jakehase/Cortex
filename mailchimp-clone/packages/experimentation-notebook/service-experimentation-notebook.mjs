import { createExperimentationNotebookWorkspace, summarizeExperimentationNotebookWorkspace, createExperimentationNotebookNarratives, createExperimentationNotebookCoverageGrid } from './domain-experimentation-notebook.mjs';
import { createExperimentationNotebookPolicies, validateExperimentationNotebookPolicies, summarizeExperimentationNotebookPolicies, createExperimentationNotebookEscalationDeck } from './policies-experimentation-notebook.mjs';
import { createExperimentationNotebookAnalyticsTimeline, createExperimentationNotebookForecastEnvelope, createExperimentationNotebookExceptionLedger, summarizeExperimentationNotebookAnalytics } from './analytics-experimentation-notebook.mjs';
import { createExperimentationNotebookOperationsBoard, createExperimentationNotebookShiftChecklist, createExperimentationNotebookIncidentDeck } from './operations-experimentation-notebook.mjs';
import { createExperimentationNotebookReportCards, createExperimentationNotebookReviewPackets, summarizeExperimentationNotebookReporting } from './reporting-experimentation-notebook.mjs';
import { createExperimentationNotebookAuditTrail, createExperimentationNotebookEvidenceManifest, createExperimentationNotebookReadinessAttestation } from './audit-experimentation-notebook.mjs';
import { createExperimentationNotebookPlaybooks, createExperimentationNotebookDecisionDeck, createExperimentationNotebookEscalationMoments } from './playbooks-experimentation-notebook.mjs';

export function buildExperimentationNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationNotebookWorkspace(workspaceName);
  const policies = createExperimentationNotebookPolicies();
  return {
    workspace,
    summary: summarizeExperimentationNotebookWorkspace(workspace),
    narratives: createExperimentationNotebookNarratives(workspace),
    coverage: createExperimentationNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationNotebookPolicies(policies),
    validation: validateExperimentationNotebookPolicies(policies),
    escalationDeck: createExperimentationNotebookEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationNotebookAnalyticsTimeline(),
      forecast: createExperimentationNotebookForecastEnvelope(),
      exceptions: createExperimentationNotebookExceptionLedger(),
      summary: summarizeExperimentationNotebookAnalytics()
    },
    operations: {
      board: createExperimentationNotebookOperationsBoard(),
      checklist: createExperimentationNotebookShiftChecklist(),
      incidents: createExperimentationNotebookIncidentDeck()
    },
    reporting: {
      cards: createExperimentationNotebookReportCards(),
      packets: createExperimentationNotebookReviewPackets(),
      summary: summarizeExperimentationNotebookReporting()
    },
    audit: {
      trail: createExperimentationNotebookAuditTrail(),
      manifest: createExperimentationNotebookEvidenceManifest(),
      attestation: createExperimentationNotebookReadinessAttestation()
    },
    playbooks: createExperimentationNotebookPlaybooks(),
    decisions: createExperimentationNotebookDecisionDeck(),
    escalationMoments: createExperimentationNotebookEscalationMoments()
  };
}

export function createExperimentationNotebookReadinessBoard(snapshot = buildExperimentationNotebookSnapshot()) {
  return [
    { id: 'experimentation-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationNotebookApiDocument(snapshot = buildExperimentationNotebookSnapshot()) {
  return {
    id: 'experimentation-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-notebook/overview' },
      { method: 'GET', path: '/api/experimentation-notebook/reporting' },
      { method: 'POST', path: '/api/experimentation-notebook/validate' },
      { method: 'GET', path: '/api/experimentation-notebook/audit' }
    ],
    readiness: createExperimentationNotebookReadinessBoard(snapshot)
  };
}

export function createExperimentationNotebookRouteSummary(snapshot = buildExperimentationNotebookSnapshot()) {
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

