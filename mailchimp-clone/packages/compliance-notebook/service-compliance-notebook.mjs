import { createComplianceNotebookWorkspace, summarizeComplianceNotebookWorkspace, createComplianceNotebookNarratives, createComplianceNotebookCoverageGrid } from './domain-compliance-notebook.mjs';
import { createComplianceNotebookPolicies, validateComplianceNotebookPolicies, summarizeComplianceNotebookPolicies, createComplianceNotebookEscalationDeck } from './policies-compliance-notebook.mjs';
import { createComplianceNotebookAnalyticsTimeline, createComplianceNotebookForecastEnvelope, createComplianceNotebookExceptionLedger, summarizeComplianceNotebookAnalytics } from './analytics-compliance-notebook.mjs';
import { createComplianceNotebookOperationsBoard, createComplianceNotebookShiftChecklist, createComplianceNotebookIncidentDeck } from './operations-compliance-notebook.mjs';
import { createComplianceNotebookReportCards, createComplianceNotebookReviewPackets, summarizeComplianceNotebookReporting } from './reporting-compliance-notebook.mjs';
import { createComplianceNotebookAuditTrail, createComplianceNotebookEvidenceManifest, createComplianceNotebookReadinessAttestation } from './audit-compliance-notebook.mjs';
import { createComplianceNotebookPlaybooks, createComplianceNotebookDecisionDeck, createComplianceNotebookEscalationMoments } from './playbooks-compliance-notebook.mjs';

export function buildComplianceNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceNotebookWorkspace(workspaceName);
  const policies = createComplianceNotebookPolicies();
  return {
    workspace,
    summary: summarizeComplianceNotebookWorkspace(workspace),
    narratives: createComplianceNotebookNarratives(workspace),
    coverage: createComplianceNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceNotebookPolicies(policies),
    validation: validateComplianceNotebookPolicies(policies),
    escalationDeck: createComplianceNotebookEscalationDeck(policies),
    analytics: {
      timeline: createComplianceNotebookAnalyticsTimeline(),
      forecast: createComplianceNotebookForecastEnvelope(),
      exceptions: createComplianceNotebookExceptionLedger(),
      summary: summarizeComplianceNotebookAnalytics()
    },
    operations: {
      board: createComplianceNotebookOperationsBoard(),
      checklist: createComplianceNotebookShiftChecklist(),
      incidents: createComplianceNotebookIncidentDeck()
    },
    reporting: {
      cards: createComplianceNotebookReportCards(),
      packets: createComplianceNotebookReviewPackets(),
      summary: summarizeComplianceNotebookReporting()
    },
    audit: {
      trail: createComplianceNotebookAuditTrail(),
      manifest: createComplianceNotebookEvidenceManifest(),
      attestation: createComplianceNotebookReadinessAttestation()
    },
    playbooks: createComplianceNotebookPlaybooks(),
    decisions: createComplianceNotebookDecisionDeck(),
    escalationMoments: createComplianceNotebookEscalationMoments()
  };
}

export function createComplianceNotebookReadinessBoard(snapshot = buildComplianceNotebookSnapshot()) {
  return [
    { id: 'compliance-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceNotebookApiDocument(snapshot = buildComplianceNotebookSnapshot()) {
  return {
    id: 'compliance-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-notebook/overview' },
      { method: 'GET', path: '/api/compliance-notebook/reporting' },
      { method: 'POST', path: '/api/compliance-notebook/validate' },
      { method: 'GET', path: '/api/compliance-notebook/audit' }
    ],
    readiness: createComplianceNotebookReadinessBoard(snapshot)
  };
}

export function createComplianceNotebookRouteSummary(snapshot = buildComplianceNotebookSnapshot()) {
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

