import { createInsightsNotebookWorkspace, summarizeInsightsNotebookWorkspace, createInsightsNotebookNarratives, createInsightsNotebookCoverageGrid } from './domain-insights-notebook.mjs';
import { createInsightsNotebookPolicies, validateInsightsNotebookPolicies, summarizeInsightsNotebookPolicies, createInsightsNotebookEscalationDeck } from './policies-insights-notebook.mjs';
import { createInsightsNotebookAnalyticsTimeline, createInsightsNotebookForecastEnvelope, createInsightsNotebookExceptionLedger, summarizeInsightsNotebookAnalytics } from './analytics-insights-notebook.mjs';
import { createInsightsNotebookOperationsBoard, createInsightsNotebookShiftChecklist, createInsightsNotebookIncidentDeck } from './operations-insights-notebook.mjs';
import { createInsightsNotebookReportCards, createInsightsNotebookReviewPackets, summarizeInsightsNotebookReporting } from './reporting-insights-notebook.mjs';
import { createInsightsNotebookAuditTrail, createInsightsNotebookEvidenceManifest, createInsightsNotebookReadinessAttestation } from './audit-insights-notebook.mjs';
import { createInsightsNotebookPlaybooks, createInsightsNotebookDecisionDeck, createInsightsNotebookEscalationMoments } from './playbooks-insights-notebook.mjs';

export function buildInsightsNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsNotebookWorkspace(workspaceName);
  const policies = createInsightsNotebookPolicies();
  return {
    workspace,
    summary: summarizeInsightsNotebookWorkspace(workspace),
    narratives: createInsightsNotebookNarratives(workspace),
    coverage: createInsightsNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsNotebookPolicies(policies),
    validation: validateInsightsNotebookPolicies(policies),
    escalationDeck: createInsightsNotebookEscalationDeck(policies),
    analytics: {
      timeline: createInsightsNotebookAnalyticsTimeline(),
      forecast: createInsightsNotebookForecastEnvelope(),
      exceptions: createInsightsNotebookExceptionLedger(),
      summary: summarizeInsightsNotebookAnalytics()
    },
    operations: {
      board: createInsightsNotebookOperationsBoard(),
      checklist: createInsightsNotebookShiftChecklist(),
      incidents: createInsightsNotebookIncidentDeck()
    },
    reporting: {
      cards: createInsightsNotebookReportCards(),
      packets: createInsightsNotebookReviewPackets(),
      summary: summarizeInsightsNotebookReporting()
    },
    audit: {
      trail: createInsightsNotebookAuditTrail(),
      manifest: createInsightsNotebookEvidenceManifest(),
      attestation: createInsightsNotebookReadinessAttestation()
    },
    playbooks: createInsightsNotebookPlaybooks(),
    decisions: createInsightsNotebookDecisionDeck(),
    escalationMoments: createInsightsNotebookEscalationMoments()
  };
}

export function createInsightsNotebookReadinessBoard(snapshot = buildInsightsNotebookSnapshot()) {
  return [
    { id: 'insights-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsNotebookApiDocument(snapshot = buildInsightsNotebookSnapshot()) {
  return {
    id: 'insights-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-notebook/overview' },
      { method: 'GET', path: '/api/insights-notebook/reporting' },
      { method: 'POST', path: '/api/insights-notebook/validate' },
      { method: 'GET', path: '/api/insights-notebook/audit' }
    ],
    readiness: createInsightsNotebookReadinessBoard(snapshot)
  };
}

export function createInsightsNotebookRouteSummary(snapshot = buildInsightsNotebookSnapshot()) {
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

