import { createCustomerNotebookWorkspace, summarizeCustomerNotebookWorkspace, createCustomerNotebookNarratives, createCustomerNotebookCoverageGrid } from './domain-customer-notebook.mjs';
import { createCustomerNotebookPolicies, validateCustomerNotebookPolicies, summarizeCustomerNotebookPolicies, createCustomerNotebookEscalationDeck } from './policies-customer-notebook.mjs';
import { createCustomerNotebookAnalyticsTimeline, createCustomerNotebookForecastEnvelope, createCustomerNotebookExceptionLedger, summarizeCustomerNotebookAnalytics } from './analytics-customer-notebook.mjs';
import { createCustomerNotebookOperationsBoard, createCustomerNotebookShiftChecklist, createCustomerNotebookIncidentDeck } from './operations-customer-notebook.mjs';
import { createCustomerNotebookReportCards, createCustomerNotebookReviewPackets, summarizeCustomerNotebookReporting } from './reporting-customer-notebook.mjs';
import { createCustomerNotebookAuditTrail, createCustomerNotebookEvidenceManifest, createCustomerNotebookReadinessAttestation } from './audit-customer-notebook.mjs';
import { createCustomerNotebookPlaybooks, createCustomerNotebookDecisionDeck, createCustomerNotebookEscalationMoments } from './playbooks-customer-notebook.mjs';

export function buildCustomerNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerNotebookWorkspace(workspaceName);
  const policies = createCustomerNotebookPolicies();
  return {
    workspace,
    summary: summarizeCustomerNotebookWorkspace(workspace),
    narratives: createCustomerNotebookNarratives(workspace),
    coverage: createCustomerNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerNotebookPolicies(policies),
    validation: validateCustomerNotebookPolicies(policies),
    escalationDeck: createCustomerNotebookEscalationDeck(policies),
    analytics: {
      timeline: createCustomerNotebookAnalyticsTimeline(),
      forecast: createCustomerNotebookForecastEnvelope(),
      exceptions: createCustomerNotebookExceptionLedger(),
      summary: summarizeCustomerNotebookAnalytics()
    },
    operations: {
      board: createCustomerNotebookOperationsBoard(),
      checklist: createCustomerNotebookShiftChecklist(),
      incidents: createCustomerNotebookIncidentDeck()
    },
    reporting: {
      cards: createCustomerNotebookReportCards(),
      packets: createCustomerNotebookReviewPackets(),
      summary: summarizeCustomerNotebookReporting()
    },
    audit: {
      trail: createCustomerNotebookAuditTrail(),
      manifest: createCustomerNotebookEvidenceManifest(),
      attestation: createCustomerNotebookReadinessAttestation()
    },
    playbooks: createCustomerNotebookPlaybooks(),
    decisions: createCustomerNotebookDecisionDeck(),
    escalationMoments: createCustomerNotebookEscalationMoments()
  };
}

export function createCustomerNotebookReadinessBoard(snapshot = buildCustomerNotebookSnapshot()) {
  return [
    { id: 'customer-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerNotebookApiDocument(snapshot = buildCustomerNotebookSnapshot()) {
  return {
    id: 'customer-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-notebook/overview' },
      { method: 'GET', path: '/api/customer-notebook/reporting' },
      { method: 'POST', path: '/api/customer-notebook/validate' },
      { method: 'GET', path: '/api/customer-notebook/audit' }
    ],
    readiness: createCustomerNotebookReadinessBoard(snapshot)
  };
}

export function createCustomerNotebookRouteSummary(snapshot = buildCustomerNotebookSnapshot()) {
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

