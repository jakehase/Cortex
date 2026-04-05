import { createCommerceNotebookWorkspace, summarizeCommerceNotebookWorkspace, createCommerceNotebookNarratives, createCommerceNotebookCoverageGrid } from './domain-commerce-notebook.mjs';
import { createCommerceNotebookPolicies, validateCommerceNotebookPolicies, summarizeCommerceNotebookPolicies, createCommerceNotebookEscalationDeck } from './policies-commerce-notebook.mjs';
import { createCommerceNotebookAnalyticsTimeline, createCommerceNotebookForecastEnvelope, createCommerceNotebookExceptionLedger, summarizeCommerceNotebookAnalytics } from './analytics-commerce-notebook.mjs';
import { createCommerceNotebookOperationsBoard, createCommerceNotebookShiftChecklist, createCommerceNotebookIncidentDeck } from './operations-commerce-notebook.mjs';
import { createCommerceNotebookReportCards, createCommerceNotebookReviewPackets, summarizeCommerceNotebookReporting } from './reporting-commerce-notebook.mjs';
import { createCommerceNotebookAuditTrail, createCommerceNotebookEvidenceManifest, createCommerceNotebookReadinessAttestation } from './audit-commerce-notebook.mjs';
import { createCommerceNotebookPlaybooks, createCommerceNotebookDecisionDeck, createCommerceNotebookEscalationMoments } from './playbooks-commerce-notebook.mjs';

export function buildCommerceNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceNotebookWorkspace(workspaceName);
  const policies = createCommerceNotebookPolicies();
  return {
    workspace,
    summary: summarizeCommerceNotebookWorkspace(workspace),
    narratives: createCommerceNotebookNarratives(workspace),
    coverage: createCommerceNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceNotebookPolicies(policies),
    validation: validateCommerceNotebookPolicies(policies),
    escalationDeck: createCommerceNotebookEscalationDeck(policies),
    analytics: {
      timeline: createCommerceNotebookAnalyticsTimeline(),
      forecast: createCommerceNotebookForecastEnvelope(),
      exceptions: createCommerceNotebookExceptionLedger(),
      summary: summarizeCommerceNotebookAnalytics()
    },
    operations: {
      board: createCommerceNotebookOperationsBoard(),
      checklist: createCommerceNotebookShiftChecklist(),
      incidents: createCommerceNotebookIncidentDeck()
    },
    reporting: {
      cards: createCommerceNotebookReportCards(),
      packets: createCommerceNotebookReviewPackets(),
      summary: summarizeCommerceNotebookReporting()
    },
    audit: {
      trail: createCommerceNotebookAuditTrail(),
      manifest: createCommerceNotebookEvidenceManifest(),
      attestation: createCommerceNotebookReadinessAttestation()
    },
    playbooks: createCommerceNotebookPlaybooks(),
    decisions: createCommerceNotebookDecisionDeck(),
    escalationMoments: createCommerceNotebookEscalationMoments()
  };
}

export function createCommerceNotebookReadinessBoard(snapshot = buildCommerceNotebookSnapshot()) {
  return [
    { id: 'commerce-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceNotebookApiDocument(snapshot = buildCommerceNotebookSnapshot()) {
  return {
    id: 'commerce-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-notebook/overview' },
      { method: 'GET', path: '/api/commerce-notebook/reporting' },
      { method: 'POST', path: '/api/commerce-notebook/validate' },
      { method: 'GET', path: '/api/commerce-notebook/audit' }
    ],
    readiness: createCommerceNotebookReadinessBoard(snapshot)
  };
}

export function createCommerceNotebookRouteSummary(snapshot = buildCommerceNotebookSnapshot()) {
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

