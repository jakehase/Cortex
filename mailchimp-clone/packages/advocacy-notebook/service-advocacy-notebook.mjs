import { createAdvocacyNotebookWorkspace, summarizeAdvocacyNotebookWorkspace, createAdvocacyNotebookNarratives, createAdvocacyNotebookCoverageGrid } from './domain-advocacy-notebook.mjs';
import { createAdvocacyNotebookPolicies, validateAdvocacyNotebookPolicies, summarizeAdvocacyNotebookPolicies, createAdvocacyNotebookEscalationDeck } from './policies-advocacy-notebook.mjs';
import { createAdvocacyNotebookAnalyticsTimeline, createAdvocacyNotebookForecastEnvelope, createAdvocacyNotebookExceptionLedger, summarizeAdvocacyNotebookAnalytics } from './analytics-advocacy-notebook.mjs';
import { createAdvocacyNotebookOperationsBoard, createAdvocacyNotebookShiftChecklist, createAdvocacyNotebookIncidentDeck } from './operations-advocacy-notebook.mjs';
import { createAdvocacyNotebookReportCards, createAdvocacyNotebookReviewPackets, summarizeAdvocacyNotebookReporting } from './reporting-advocacy-notebook.mjs';
import { createAdvocacyNotebookAuditTrail, createAdvocacyNotebookEvidenceManifest, createAdvocacyNotebookReadinessAttestation } from './audit-advocacy-notebook.mjs';
import { createAdvocacyNotebookPlaybooks, createAdvocacyNotebookDecisionDeck, createAdvocacyNotebookEscalationMoments } from './playbooks-advocacy-notebook.mjs';

export function buildAdvocacyNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyNotebookWorkspace(workspaceName);
  const policies = createAdvocacyNotebookPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyNotebookWorkspace(workspace),
    narratives: createAdvocacyNotebookNarratives(workspace),
    coverage: createAdvocacyNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyNotebookPolicies(policies),
    validation: validateAdvocacyNotebookPolicies(policies),
    escalationDeck: createAdvocacyNotebookEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyNotebookAnalyticsTimeline(),
      forecast: createAdvocacyNotebookForecastEnvelope(),
      exceptions: createAdvocacyNotebookExceptionLedger(),
      summary: summarizeAdvocacyNotebookAnalytics()
    },
    operations: {
      board: createAdvocacyNotebookOperationsBoard(),
      checklist: createAdvocacyNotebookShiftChecklist(),
      incidents: createAdvocacyNotebookIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyNotebookReportCards(),
      packets: createAdvocacyNotebookReviewPackets(),
      summary: summarizeAdvocacyNotebookReporting()
    },
    audit: {
      trail: createAdvocacyNotebookAuditTrail(),
      manifest: createAdvocacyNotebookEvidenceManifest(),
      attestation: createAdvocacyNotebookReadinessAttestation()
    },
    playbooks: createAdvocacyNotebookPlaybooks(),
    decisions: createAdvocacyNotebookDecisionDeck(),
    escalationMoments: createAdvocacyNotebookEscalationMoments()
  };
}

export function createAdvocacyNotebookReadinessBoard(snapshot = buildAdvocacyNotebookSnapshot()) {
  return [
    { id: 'advocacy-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyNotebookApiDocument(snapshot = buildAdvocacyNotebookSnapshot()) {
  return {
    id: 'advocacy-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-notebook/overview' },
      { method: 'GET', path: '/api/advocacy-notebook/reporting' },
      { method: 'POST', path: '/api/advocacy-notebook/validate' },
      { method: 'GET', path: '/api/advocacy-notebook/audit' }
    ],
    readiness: createAdvocacyNotebookReadinessBoard(snapshot)
  };
}

export function createAdvocacyNotebookRouteSummary(snapshot = buildAdvocacyNotebookSnapshot()) {
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

