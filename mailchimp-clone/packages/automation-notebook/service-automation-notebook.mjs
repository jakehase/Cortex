import { createAutomationNotebookWorkspace, summarizeAutomationNotebookWorkspace, createAutomationNotebookNarratives, createAutomationNotebookCoverageGrid } from './domain-automation-notebook.mjs';
import { createAutomationNotebookPolicies, validateAutomationNotebookPolicies, summarizeAutomationNotebookPolicies, createAutomationNotebookEscalationDeck } from './policies-automation-notebook.mjs';
import { createAutomationNotebookAnalyticsTimeline, createAutomationNotebookForecastEnvelope, createAutomationNotebookExceptionLedger, summarizeAutomationNotebookAnalytics } from './analytics-automation-notebook.mjs';
import { createAutomationNotebookOperationsBoard, createAutomationNotebookShiftChecklist, createAutomationNotebookIncidentDeck } from './operations-automation-notebook.mjs';
import { createAutomationNotebookReportCards, createAutomationNotebookReviewPackets, summarizeAutomationNotebookReporting } from './reporting-automation-notebook.mjs';
import { createAutomationNotebookAuditTrail, createAutomationNotebookEvidenceManifest, createAutomationNotebookReadinessAttestation } from './audit-automation-notebook.mjs';
import { createAutomationNotebookPlaybooks, createAutomationNotebookDecisionDeck, createAutomationNotebookEscalationMoments } from './playbooks-automation-notebook.mjs';

export function buildAutomationNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationNotebookWorkspace(workspaceName);
  const policies = createAutomationNotebookPolicies();
  return {
    workspace,
    summary: summarizeAutomationNotebookWorkspace(workspace),
    narratives: createAutomationNotebookNarratives(workspace),
    coverage: createAutomationNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationNotebookPolicies(policies),
    validation: validateAutomationNotebookPolicies(policies),
    escalationDeck: createAutomationNotebookEscalationDeck(policies),
    analytics: {
      timeline: createAutomationNotebookAnalyticsTimeline(),
      forecast: createAutomationNotebookForecastEnvelope(),
      exceptions: createAutomationNotebookExceptionLedger(),
      summary: summarizeAutomationNotebookAnalytics()
    },
    operations: {
      board: createAutomationNotebookOperationsBoard(),
      checklist: createAutomationNotebookShiftChecklist(),
      incidents: createAutomationNotebookIncidentDeck()
    },
    reporting: {
      cards: createAutomationNotebookReportCards(),
      packets: createAutomationNotebookReviewPackets(),
      summary: summarizeAutomationNotebookReporting()
    },
    audit: {
      trail: createAutomationNotebookAuditTrail(),
      manifest: createAutomationNotebookEvidenceManifest(),
      attestation: createAutomationNotebookReadinessAttestation()
    },
    playbooks: createAutomationNotebookPlaybooks(),
    decisions: createAutomationNotebookDecisionDeck(),
    escalationMoments: createAutomationNotebookEscalationMoments()
  };
}

export function createAutomationNotebookReadinessBoard(snapshot = buildAutomationNotebookSnapshot()) {
  return [
    { id: 'automation-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationNotebookApiDocument(snapshot = buildAutomationNotebookSnapshot()) {
  return {
    id: 'automation-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-notebook/overview' },
      { method: 'GET', path: '/api/automation-notebook/reporting' },
      { method: 'POST', path: '/api/automation-notebook/validate' },
      { method: 'GET', path: '/api/automation-notebook/audit' }
    ],
    readiness: createAutomationNotebookReadinessBoard(snapshot)
  };
}

export function createAutomationNotebookRouteSummary(snapshot = buildAutomationNotebookSnapshot()) {
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

