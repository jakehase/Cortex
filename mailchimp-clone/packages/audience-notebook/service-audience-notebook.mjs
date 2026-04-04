import { createAudienceNotebookWorkspace, summarizeAudienceNotebookWorkspace, createAudienceNotebookNarratives, createAudienceNotebookCoverageGrid } from './domain-audience-notebook.mjs';
import { createAudienceNotebookPolicies, validateAudienceNotebookPolicies, summarizeAudienceNotebookPolicies, createAudienceNotebookEscalationDeck } from './policies-audience-notebook.mjs';
import { createAudienceNotebookAnalyticsTimeline, createAudienceNotebookForecastEnvelope, createAudienceNotebookExceptionLedger, summarizeAudienceNotebookAnalytics } from './analytics-audience-notebook.mjs';
import { createAudienceNotebookOperationsBoard, createAudienceNotebookShiftChecklist, createAudienceNotebookIncidentDeck } from './operations-audience-notebook.mjs';
import { createAudienceNotebookReportCards, createAudienceNotebookReviewPackets, summarizeAudienceNotebookReporting } from './reporting-audience-notebook.mjs';
import { createAudienceNotebookAuditTrail, createAudienceNotebookEvidenceManifest, createAudienceNotebookReadinessAttestation } from './audit-audience-notebook.mjs';
import { createAudienceNotebookPlaybooks, createAudienceNotebookDecisionDeck, createAudienceNotebookEscalationMoments } from './playbooks-audience-notebook.mjs';

export function buildAudienceNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceNotebookWorkspace(workspaceName);
  const policies = createAudienceNotebookPolicies();
  return {
    workspace,
    summary: summarizeAudienceNotebookWorkspace(workspace),
    narratives: createAudienceNotebookNarratives(workspace),
    coverage: createAudienceNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceNotebookPolicies(policies),
    validation: validateAudienceNotebookPolicies(policies),
    escalationDeck: createAudienceNotebookEscalationDeck(policies),
    analytics: {
      timeline: createAudienceNotebookAnalyticsTimeline(),
      forecast: createAudienceNotebookForecastEnvelope(),
      exceptions: createAudienceNotebookExceptionLedger(),
      summary: summarizeAudienceNotebookAnalytics()
    },
    operations: {
      board: createAudienceNotebookOperationsBoard(),
      checklist: createAudienceNotebookShiftChecklist(),
      incidents: createAudienceNotebookIncidentDeck()
    },
    reporting: {
      cards: createAudienceNotebookReportCards(),
      packets: createAudienceNotebookReviewPackets(),
      summary: summarizeAudienceNotebookReporting()
    },
    audit: {
      trail: createAudienceNotebookAuditTrail(),
      manifest: createAudienceNotebookEvidenceManifest(),
      attestation: createAudienceNotebookReadinessAttestation()
    },
    playbooks: createAudienceNotebookPlaybooks(),
    decisions: createAudienceNotebookDecisionDeck(),
    escalationMoments: createAudienceNotebookEscalationMoments()
  };
}

export function createAudienceNotebookReadinessBoard(snapshot = buildAudienceNotebookSnapshot()) {
  return [
    { id: 'audience-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceNotebookApiDocument(snapshot = buildAudienceNotebookSnapshot()) {
  return {
    id: 'audience-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-notebook/overview' },
      { method: 'GET', path: '/api/audience-notebook/reporting' },
      { method: 'POST', path: '/api/audience-notebook/validate' },
      { method: 'GET', path: '/api/audience-notebook/audit' }
    ],
    readiness: createAudienceNotebookReadinessBoard(snapshot)
  };
}

export function createAudienceNotebookRouteSummary(snapshot = buildAudienceNotebookSnapshot()) {
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

