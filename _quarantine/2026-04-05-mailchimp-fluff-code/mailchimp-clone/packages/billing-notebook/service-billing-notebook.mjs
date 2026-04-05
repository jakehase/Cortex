import { createBillingNotebookWorkspace, summarizeBillingNotebookWorkspace, createBillingNotebookNarratives, createBillingNotebookCoverageGrid } from './domain-billing-notebook.mjs';
import { createBillingNotebookPolicies, validateBillingNotebookPolicies, summarizeBillingNotebookPolicies, createBillingNotebookEscalationDeck } from './policies-billing-notebook.mjs';
import { createBillingNotebookAnalyticsTimeline, createBillingNotebookForecastEnvelope, createBillingNotebookExceptionLedger, summarizeBillingNotebookAnalytics } from './analytics-billing-notebook.mjs';
import { createBillingNotebookOperationsBoard, createBillingNotebookShiftChecklist, createBillingNotebookIncidentDeck } from './operations-billing-notebook.mjs';
import { createBillingNotebookReportCards, createBillingNotebookReviewPackets, summarizeBillingNotebookReporting } from './reporting-billing-notebook.mjs';
import { createBillingNotebookAuditTrail, createBillingNotebookEvidenceManifest, createBillingNotebookReadinessAttestation } from './audit-billing-notebook.mjs';
import { createBillingNotebookPlaybooks, createBillingNotebookDecisionDeck, createBillingNotebookEscalationMoments } from './playbooks-billing-notebook.mjs';

export function buildBillingNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingNotebookWorkspace(workspaceName);
  const policies = createBillingNotebookPolicies();
  return {
    workspace,
    summary: summarizeBillingNotebookWorkspace(workspace),
    narratives: createBillingNotebookNarratives(workspace),
    coverage: createBillingNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingNotebookPolicies(policies),
    validation: validateBillingNotebookPolicies(policies),
    escalationDeck: createBillingNotebookEscalationDeck(policies),
    analytics: {
      timeline: createBillingNotebookAnalyticsTimeline(),
      forecast: createBillingNotebookForecastEnvelope(),
      exceptions: createBillingNotebookExceptionLedger(),
      summary: summarizeBillingNotebookAnalytics()
    },
    operations: {
      board: createBillingNotebookOperationsBoard(),
      checklist: createBillingNotebookShiftChecklist(),
      incidents: createBillingNotebookIncidentDeck()
    },
    reporting: {
      cards: createBillingNotebookReportCards(),
      packets: createBillingNotebookReviewPackets(),
      summary: summarizeBillingNotebookReporting()
    },
    audit: {
      trail: createBillingNotebookAuditTrail(),
      manifest: createBillingNotebookEvidenceManifest(),
      attestation: createBillingNotebookReadinessAttestation()
    },
    playbooks: createBillingNotebookPlaybooks(),
    decisions: createBillingNotebookDecisionDeck(),
    escalationMoments: createBillingNotebookEscalationMoments()
  };
}

export function createBillingNotebookReadinessBoard(snapshot = buildBillingNotebookSnapshot()) {
  return [
    { id: 'billing-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingNotebookApiDocument(snapshot = buildBillingNotebookSnapshot()) {
  return {
    id: 'billing-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-notebook/overview' },
      { method: 'GET', path: '/api/billing-notebook/reporting' },
      { method: 'POST', path: '/api/billing-notebook/validate' },
      { method: 'GET', path: '/api/billing-notebook/audit' }
    ],
    readiness: createBillingNotebookReadinessBoard(snapshot)
  };
}

export function createBillingNotebookRouteSummary(snapshot = buildBillingNotebookSnapshot()) {
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

