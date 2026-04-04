import { createIntegrationsNotebookWorkspace, summarizeIntegrationsNotebookWorkspace, createIntegrationsNotebookNarratives, createIntegrationsNotebookCoverageGrid } from './domain-integrations-notebook.mjs';
import { createIntegrationsNotebookPolicies, validateIntegrationsNotebookPolicies, summarizeIntegrationsNotebookPolicies, createIntegrationsNotebookEscalationDeck } from './policies-integrations-notebook.mjs';
import { createIntegrationsNotebookAnalyticsTimeline, createIntegrationsNotebookForecastEnvelope, createIntegrationsNotebookExceptionLedger, summarizeIntegrationsNotebookAnalytics } from './analytics-integrations-notebook.mjs';
import { createIntegrationsNotebookOperationsBoard, createIntegrationsNotebookShiftChecklist, createIntegrationsNotebookIncidentDeck } from './operations-integrations-notebook.mjs';
import { createIntegrationsNotebookReportCards, createIntegrationsNotebookReviewPackets, summarizeIntegrationsNotebookReporting } from './reporting-integrations-notebook.mjs';
import { createIntegrationsNotebookAuditTrail, createIntegrationsNotebookEvidenceManifest, createIntegrationsNotebookReadinessAttestation } from './audit-integrations-notebook.mjs';
import { createIntegrationsNotebookPlaybooks, createIntegrationsNotebookDecisionDeck, createIntegrationsNotebookEscalationMoments } from './playbooks-integrations-notebook.mjs';

export function buildIntegrationsNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsNotebookWorkspace(workspaceName);
  const policies = createIntegrationsNotebookPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsNotebookWorkspace(workspace),
    narratives: createIntegrationsNotebookNarratives(workspace),
    coverage: createIntegrationsNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsNotebookPolicies(policies),
    validation: validateIntegrationsNotebookPolicies(policies),
    escalationDeck: createIntegrationsNotebookEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsNotebookAnalyticsTimeline(),
      forecast: createIntegrationsNotebookForecastEnvelope(),
      exceptions: createIntegrationsNotebookExceptionLedger(),
      summary: summarizeIntegrationsNotebookAnalytics()
    },
    operations: {
      board: createIntegrationsNotebookOperationsBoard(),
      checklist: createIntegrationsNotebookShiftChecklist(),
      incidents: createIntegrationsNotebookIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsNotebookReportCards(),
      packets: createIntegrationsNotebookReviewPackets(),
      summary: summarizeIntegrationsNotebookReporting()
    },
    audit: {
      trail: createIntegrationsNotebookAuditTrail(),
      manifest: createIntegrationsNotebookEvidenceManifest(),
      attestation: createIntegrationsNotebookReadinessAttestation()
    },
    playbooks: createIntegrationsNotebookPlaybooks(),
    decisions: createIntegrationsNotebookDecisionDeck(),
    escalationMoments: createIntegrationsNotebookEscalationMoments()
  };
}

export function createIntegrationsNotebookReadinessBoard(snapshot = buildIntegrationsNotebookSnapshot()) {
  return [
    { id: 'integrations-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsNotebookApiDocument(snapshot = buildIntegrationsNotebookSnapshot()) {
  return {
    id: 'integrations-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-notebook/overview' },
      { method: 'GET', path: '/api/integrations-notebook/reporting' },
      { method: 'POST', path: '/api/integrations-notebook/validate' },
      { method: 'GET', path: '/api/integrations-notebook/audit' }
    ],
    readiness: createIntegrationsNotebookReadinessBoard(snapshot)
  };
}

export function createIntegrationsNotebookRouteSummary(snapshot = buildIntegrationsNotebookSnapshot()) {
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

