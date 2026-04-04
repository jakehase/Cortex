import { createAttributionNotebookWorkspace, summarizeAttributionNotebookWorkspace, createAttributionNotebookNarratives, createAttributionNotebookCoverageGrid } from './domain-attribution-notebook.mjs';
import { createAttributionNotebookPolicies, validateAttributionNotebookPolicies, summarizeAttributionNotebookPolicies, createAttributionNotebookEscalationDeck } from './policies-attribution-notebook.mjs';
import { createAttributionNotebookAnalyticsTimeline, createAttributionNotebookForecastEnvelope, createAttributionNotebookExceptionLedger, summarizeAttributionNotebookAnalytics } from './analytics-attribution-notebook.mjs';
import { createAttributionNotebookOperationsBoard, createAttributionNotebookShiftChecklist, createAttributionNotebookIncidentDeck } from './operations-attribution-notebook.mjs';
import { createAttributionNotebookReportCards, createAttributionNotebookReviewPackets, summarizeAttributionNotebookReporting } from './reporting-attribution-notebook.mjs';
import { createAttributionNotebookAuditTrail, createAttributionNotebookEvidenceManifest, createAttributionNotebookReadinessAttestation } from './audit-attribution-notebook.mjs';
import { createAttributionNotebookPlaybooks, createAttributionNotebookDecisionDeck, createAttributionNotebookEscalationMoments } from './playbooks-attribution-notebook.mjs';

export function buildAttributionNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionNotebookWorkspace(workspaceName);
  const policies = createAttributionNotebookPolicies();
  return {
    workspace,
    summary: summarizeAttributionNotebookWorkspace(workspace),
    narratives: createAttributionNotebookNarratives(workspace),
    coverage: createAttributionNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionNotebookPolicies(policies),
    validation: validateAttributionNotebookPolicies(policies),
    escalationDeck: createAttributionNotebookEscalationDeck(policies),
    analytics: {
      timeline: createAttributionNotebookAnalyticsTimeline(),
      forecast: createAttributionNotebookForecastEnvelope(),
      exceptions: createAttributionNotebookExceptionLedger(),
      summary: summarizeAttributionNotebookAnalytics()
    },
    operations: {
      board: createAttributionNotebookOperationsBoard(),
      checklist: createAttributionNotebookShiftChecklist(),
      incidents: createAttributionNotebookIncidentDeck()
    },
    reporting: {
      cards: createAttributionNotebookReportCards(),
      packets: createAttributionNotebookReviewPackets(),
      summary: summarizeAttributionNotebookReporting()
    },
    audit: {
      trail: createAttributionNotebookAuditTrail(),
      manifest: createAttributionNotebookEvidenceManifest(),
      attestation: createAttributionNotebookReadinessAttestation()
    },
    playbooks: createAttributionNotebookPlaybooks(),
    decisions: createAttributionNotebookDecisionDeck(),
    escalationMoments: createAttributionNotebookEscalationMoments()
  };
}

export function createAttributionNotebookReadinessBoard(snapshot = buildAttributionNotebookSnapshot()) {
  return [
    { id: 'attribution-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionNotebookApiDocument(snapshot = buildAttributionNotebookSnapshot()) {
  return {
    id: 'attribution-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-notebook/overview' },
      { method: 'GET', path: '/api/attribution-notebook/reporting' },
      { method: 'POST', path: '/api/attribution-notebook/validate' },
      { method: 'GET', path: '/api/attribution-notebook/audit' }
    ],
    readiness: createAttributionNotebookReadinessBoard(snapshot)
  };
}

export function createAttributionNotebookRouteSummary(snapshot = buildAttributionNotebookSnapshot()) {
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

