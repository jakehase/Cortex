import { createAnalyticsNotebookWorkspace, summarizeAnalyticsNotebookWorkspace, createAnalyticsNotebookNarratives, createAnalyticsNotebookCoverageGrid } from './domain-analytics-notebook.mjs';
import { createAnalyticsNotebookPolicies, validateAnalyticsNotebookPolicies, summarizeAnalyticsNotebookPolicies, createAnalyticsNotebookEscalationDeck } from './policies-analytics-notebook.mjs';
import { createAnalyticsNotebookAnalyticsTimeline, createAnalyticsNotebookForecastEnvelope, createAnalyticsNotebookExceptionLedger, summarizeAnalyticsNotebookAnalytics } from './analytics-analytics-notebook.mjs';
import { createAnalyticsNotebookOperationsBoard, createAnalyticsNotebookShiftChecklist, createAnalyticsNotebookIncidentDeck } from './operations-analytics-notebook.mjs';
import { createAnalyticsNotebookReportCards, createAnalyticsNotebookReviewPackets, summarizeAnalyticsNotebookReporting } from './reporting-analytics-notebook.mjs';
import { createAnalyticsNotebookAuditTrail, createAnalyticsNotebookEvidenceManifest, createAnalyticsNotebookReadinessAttestation } from './audit-analytics-notebook.mjs';
import { createAnalyticsNotebookPlaybooks, createAnalyticsNotebookDecisionDeck, createAnalyticsNotebookEscalationMoments } from './playbooks-analytics-notebook.mjs';

export function buildAnalyticsNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsNotebookWorkspace(workspaceName);
  const policies = createAnalyticsNotebookPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsNotebookWorkspace(workspace),
    narratives: createAnalyticsNotebookNarratives(workspace),
    coverage: createAnalyticsNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsNotebookPolicies(policies),
    validation: validateAnalyticsNotebookPolicies(policies),
    escalationDeck: createAnalyticsNotebookEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsNotebookAnalyticsTimeline(),
      forecast: createAnalyticsNotebookForecastEnvelope(),
      exceptions: createAnalyticsNotebookExceptionLedger(),
      summary: summarizeAnalyticsNotebookAnalytics()
    },
    operations: {
      board: createAnalyticsNotebookOperationsBoard(),
      checklist: createAnalyticsNotebookShiftChecklist(),
      incidents: createAnalyticsNotebookIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsNotebookReportCards(),
      packets: createAnalyticsNotebookReviewPackets(),
      summary: summarizeAnalyticsNotebookReporting()
    },
    audit: {
      trail: createAnalyticsNotebookAuditTrail(),
      manifest: createAnalyticsNotebookEvidenceManifest(),
      attestation: createAnalyticsNotebookReadinessAttestation()
    },
    playbooks: createAnalyticsNotebookPlaybooks(),
    decisions: createAnalyticsNotebookDecisionDeck(),
    escalationMoments: createAnalyticsNotebookEscalationMoments()
  };
}

export function createAnalyticsNotebookReadinessBoard(snapshot = buildAnalyticsNotebookSnapshot()) {
  return [
    { id: 'analytics-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsNotebookApiDocument(snapshot = buildAnalyticsNotebookSnapshot()) {
  return {
    id: 'analytics-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-notebook/overview' },
      { method: 'GET', path: '/api/analytics-notebook/reporting' },
      { method: 'POST', path: '/api/analytics-notebook/validate' },
      { method: 'GET', path: '/api/analytics-notebook/audit' }
    ],
    readiness: createAnalyticsNotebookReadinessBoard(snapshot)
  };
}

export function createAnalyticsNotebookRouteSummary(snapshot = buildAnalyticsNotebookSnapshot()) {
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

