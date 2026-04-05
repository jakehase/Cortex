import { createEcommerceNotebookWorkspace, summarizeEcommerceNotebookWorkspace, createEcommerceNotebookNarratives, createEcommerceNotebookCoverageGrid } from './domain-ecommerce-notebook.mjs';
import { createEcommerceNotebookPolicies, validateEcommerceNotebookPolicies, summarizeEcommerceNotebookPolicies, createEcommerceNotebookEscalationDeck } from './policies-ecommerce-notebook.mjs';
import { createEcommerceNotebookAnalyticsTimeline, createEcommerceNotebookForecastEnvelope, createEcommerceNotebookExceptionLedger, summarizeEcommerceNotebookAnalytics } from './analytics-ecommerce-notebook.mjs';
import { createEcommerceNotebookOperationsBoard, createEcommerceNotebookShiftChecklist, createEcommerceNotebookIncidentDeck } from './operations-ecommerce-notebook.mjs';
import { createEcommerceNotebookReportCards, createEcommerceNotebookReviewPackets, summarizeEcommerceNotebookReporting } from './reporting-ecommerce-notebook.mjs';
import { createEcommerceNotebookAuditTrail, createEcommerceNotebookEvidenceManifest, createEcommerceNotebookReadinessAttestation } from './audit-ecommerce-notebook.mjs';
import { createEcommerceNotebookPlaybooks, createEcommerceNotebookDecisionDeck, createEcommerceNotebookEscalationMoments } from './playbooks-ecommerce-notebook.mjs';

export function buildEcommerceNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceNotebookWorkspace(workspaceName);
  const policies = createEcommerceNotebookPolicies();
  return {
    workspace,
    summary: summarizeEcommerceNotebookWorkspace(workspace),
    narratives: createEcommerceNotebookNarratives(workspace),
    coverage: createEcommerceNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceNotebookPolicies(policies),
    validation: validateEcommerceNotebookPolicies(policies),
    escalationDeck: createEcommerceNotebookEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceNotebookAnalyticsTimeline(),
      forecast: createEcommerceNotebookForecastEnvelope(),
      exceptions: createEcommerceNotebookExceptionLedger(),
      summary: summarizeEcommerceNotebookAnalytics()
    },
    operations: {
      board: createEcommerceNotebookOperationsBoard(),
      checklist: createEcommerceNotebookShiftChecklist(),
      incidents: createEcommerceNotebookIncidentDeck()
    },
    reporting: {
      cards: createEcommerceNotebookReportCards(),
      packets: createEcommerceNotebookReviewPackets(),
      summary: summarizeEcommerceNotebookReporting()
    },
    audit: {
      trail: createEcommerceNotebookAuditTrail(),
      manifest: createEcommerceNotebookEvidenceManifest(),
      attestation: createEcommerceNotebookReadinessAttestation()
    },
    playbooks: createEcommerceNotebookPlaybooks(),
    decisions: createEcommerceNotebookDecisionDeck(),
    escalationMoments: createEcommerceNotebookEscalationMoments()
  };
}

export function createEcommerceNotebookReadinessBoard(snapshot = buildEcommerceNotebookSnapshot()) {
  return [
    { id: 'ecommerce-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceNotebookApiDocument(snapshot = buildEcommerceNotebookSnapshot()) {
  return {
    id: 'ecommerce-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-notebook/overview' },
      { method: 'GET', path: '/api/ecommerce-notebook/reporting' },
      { method: 'POST', path: '/api/ecommerce-notebook/validate' },
      { method: 'GET', path: '/api/ecommerce-notebook/audit' }
    ],
    readiness: createEcommerceNotebookReadinessBoard(snapshot)
  };
}

export function createEcommerceNotebookRouteSummary(snapshot = buildEcommerceNotebookSnapshot()) {
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

