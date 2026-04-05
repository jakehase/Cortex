import { createDeliverabilityNotebookWorkspace, summarizeDeliverabilityNotebookWorkspace, createDeliverabilityNotebookNarratives, createDeliverabilityNotebookCoverageGrid } from './domain-deliverability-notebook.mjs';
import { createDeliverabilityNotebookPolicies, validateDeliverabilityNotebookPolicies, summarizeDeliverabilityNotebookPolicies, createDeliverabilityNotebookEscalationDeck } from './policies-deliverability-notebook.mjs';
import { createDeliverabilityNotebookAnalyticsTimeline, createDeliverabilityNotebookForecastEnvelope, createDeliverabilityNotebookExceptionLedger, summarizeDeliverabilityNotebookAnalytics } from './analytics-deliverability-notebook.mjs';
import { createDeliverabilityNotebookOperationsBoard, createDeliverabilityNotebookShiftChecklist, createDeliverabilityNotebookIncidentDeck } from './operations-deliverability-notebook.mjs';
import { createDeliverabilityNotebookReportCards, createDeliverabilityNotebookReviewPackets, summarizeDeliverabilityNotebookReporting } from './reporting-deliverability-notebook.mjs';
import { createDeliverabilityNotebookAuditTrail, createDeliverabilityNotebookEvidenceManifest, createDeliverabilityNotebookReadinessAttestation } from './audit-deliverability-notebook.mjs';
import { createDeliverabilityNotebookPlaybooks, createDeliverabilityNotebookDecisionDeck, createDeliverabilityNotebookEscalationMoments } from './playbooks-deliverability-notebook.mjs';

export function buildDeliverabilityNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityNotebookWorkspace(workspaceName);
  const policies = createDeliverabilityNotebookPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityNotebookWorkspace(workspace),
    narratives: createDeliverabilityNotebookNarratives(workspace),
    coverage: createDeliverabilityNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityNotebookPolicies(policies),
    validation: validateDeliverabilityNotebookPolicies(policies),
    escalationDeck: createDeliverabilityNotebookEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityNotebookAnalyticsTimeline(),
      forecast: createDeliverabilityNotebookForecastEnvelope(),
      exceptions: createDeliverabilityNotebookExceptionLedger(),
      summary: summarizeDeliverabilityNotebookAnalytics()
    },
    operations: {
      board: createDeliverabilityNotebookOperationsBoard(),
      checklist: createDeliverabilityNotebookShiftChecklist(),
      incidents: createDeliverabilityNotebookIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityNotebookReportCards(),
      packets: createDeliverabilityNotebookReviewPackets(),
      summary: summarizeDeliverabilityNotebookReporting()
    },
    audit: {
      trail: createDeliverabilityNotebookAuditTrail(),
      manifest: createDeliverabilityNotebookEvidenceManifest(),
      attestation: createDeliverabilityNotebookReadinessAttestation()
    },
    playbooks: createDeliverabilityNotebookPlaybooks(),
    decisions: createDeliverabilityNotebookDecisionDeck(),
    escalationMoments: createDeliverabilityNotebookEscalationMoments()
  };
}

export function createDeliverabilityNotebookReadinessBoard(snapshot = buildDeliverabilityNotebookSnapshot()) {
  return [
    { id: 'deliverability-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityNotebookApiDocument(snapshot = buildDeliverabilityNotebookSnapshot()) {
  return {
    id: 'deliverability-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-notebook/overview' },
      { method: 'GET', path: '/api/deliverability-notebook/reporting' },
      { method: 'POST', path: '/api/deliverability-notebook/validate' },
      { method: 'GET', path: '/api/deliverability-notebook/audit' }
    ],
    readiness: createDeliverabilityNotebookReadinessBoard(snapshot)
  };
}

export function createDeliverabilityNotebookRouteSummary(snapshot = buildDeliverabilityNotebookSnapshot()) {
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

