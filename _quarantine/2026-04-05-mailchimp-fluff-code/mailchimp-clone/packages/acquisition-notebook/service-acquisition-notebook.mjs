import { createAcquisitionNotebookWorkspace, summarizeAcquisitionNotebookWorkspace, createAcquisitionNotebookNarratives, createAcquisitionNotebookCoverageGrid } from './domain-acquisition-notebook.mjs';
import { createAcquisitionNotebookPolicies, validateAcquisitionNotebookPolicies, summarizeAcquisitionNotebookPolicies, createAcquisitionNotebookEscalationDeck } from './policies-acquisition-notebook.mjs';
import { createAcquisitionNotebookAnalyticsTimeline, createAcquisitionNotebookForecastEnvelope, createAcquisitionNotebookExceptionLedger, summarizeAcquisitionNotebookAnalytics } from './analytics-acquisition-notebook.mjs';
import { createAcquisitionNotebookOperationsBoard, createAcquisitionNotebookShiftChecklist, createAcquisitionNotebookIncidentDeck } from './operations-acquisition-notebook.mjs';
import { createAcquisitionNotebookReportCards, createAcquisitionNotebookReviewPackets, summarizeAcquisitionNotebookReporting } from './reporting-acquisition-notebook.mjs';
import { createAcquisitionNotebookAuditTrail, createAcquisitionNotebookEvidenceManifest, createAcquisitionNotebookReadinessAttestation } from './audit-acquisition-notebook.mjs';
import { createAcquisitionNotebookPlaybooks, createAcquisitionNotebookDecisionDeck, createAcquisitionNotebookEscalationMoments } from './playbooks-acquisition-notebook.mjs';

export function buildAcquisitionNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionNotebookWorkspace(workspaceName);
  const policies = createAcquisitionNotebookPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionNotebookWorkspace(workspace),
    narratives: createAcquisitionNotebookNarratives(workspace),
    coverage: createAcquisitionNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionNotebookPolicies(policies),
    validation: validateAcquisitionNotebookPolicies(policies),
    escalationDeck: createAcquisitionNotebookEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionNotebookAnalyticsTimeline(),
      forecast: createAcquisitionNotebookForecastEnvelope(),
      exceptions: createAcquisitionNotebookExceptionLedger(),
      summary: summarizeAcquisitionNotebookAnalytics()
    },
    operations: {
      board: createAcquisitionNotebookOperationsBoard(),
      checklist: createAcquisitionNotebookShiftChecklist(),
      incidents: createAcquisitionNotebookIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionNotebookReportCards(),
      packets: createAcquisitionNotebookReviewPackets(),
      summary: summarizeAcquisitionNotebookReporting()
    },
    audit: {
      trail: createAcquisitionNotebookAuditTrail(),
      manifest: createAcquisitionNotebookEvidenceManifest(),
      attestation: createAcquisitionNotebookReadinessAttestation()
    },
    playbooks: createAcquisitionNotebookPlaybooks(),
    decisions: createAcquisitionNotebookDecisionDeck(),
    escalationMoments: createAcquisitionNotebookEscalationMoments()
  };
}

export function createAcquisitionNotebookReadinessBoard(snapshot = buildAcquisitionNotebookSnapshot()) {
  return [
    { id: 'acquisition-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionNotebookApiDocument(snapshot = buildAcquisitionNotebookSnapshot()) {
  return {
    id: 'acquisition-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-notebook/overview' },
      { method: 'GET', path: '/api/acquisition-notebook/reporting' },
      { method: 'POST', path: '/api/acquisition-notebook/validate' },
      { method: 'GET', path: '/api/acquisition-notebook/audit' }
    ],
    readiness: createAcquisitionNotebookReadinessBoard(snapshot)
  };
}

export function createAcquisitionNotebookRouteSummary(snapshot = buildAcquisitionNotebookSnapshot()) {
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

