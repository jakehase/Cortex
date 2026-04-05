import { createLoyaltyNotebookWorkspace, summarizeLoyaltyNotebookWorkspace, createLoyaltyNotebookNarratives, createLoyaltyNotebookCoverageGrid } from './domain-loyalty-notebook.mjs';
import { createLoyaltyNotebookPolicies, validateLoyaltyNotebookPolicies, summarizeLoyaltyNotebookPolicies, createLoyaltyNotebookEscalationDeck } from './policies-loyalty-notebook.mjs';
import { createLoyaltyNotebookAnalyticsTimeline, createLoyaltyNotebookForecastEnvelope, createLoyaltyNotebookExceptionLedger, summarizeLoyaltyNotebookAnalytics } from './analytics-loyalty-notebook.mjs';
import { createLoyaltyNotebookOperationsBoard, createLoyaltyNotebookShiftChecklist, createLoyaltyNotebookIncidentDeck } from './operations-loyalty-notebook.mjs';
import { createLoyaltyNotebookReportCards, createLoyaltyNotebookReviewPackets, summarizeLoyaltyNotebookReporting } from './reporting-loyalty-notebook.mjs';
import { createLoyaltyNotebookAuditTrail, createLoyaltyNotebookEvidenceManifest, createLoyaltyNotebookReadinessAttestation } from './audit-loyalty-notebook.mjs';
import { createLoyaltyNotebookPlaybooks, createLoyaltyNotebookDecisionDeck, createLoyaltyNotebookEscalationMoments } from './playbooks-loyalty-notebook.mjs';

export function buildLoyaltyNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyNotebookWorkspace(workspaceName);
  const policies = createLoyaltyNotebookPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyNotebookWorkspace(workspace),
    narratives: createLoyaltyNotebookNarratives(workspace),
    coverage: createLoyaltyNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyNotebookPolicies(policies),
    validation: validateLoyaltyNotebookPolicies(policies),
    escalationDeck: createLoyaltyNotebookEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyNotebookAnalyticsTimeline(),
      forecast: createLoyaltyNotebookForecastEnvelope(),
      exceptions: createLoyaltyNotebookExceptionLedger(),
      summary: summarizeLoyaltyNotebookAnalytics()
    },
    operations: {
      board: createLoyaltyNotebookOperationsBoard(),
      checklist: createLoyaltyNotebookShiftChecklist(),
      incidents: createLoyaltyNotebookIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyNotebookReportCards(),
      packets: createLoyaltyNotebookReviewPackets(),
      summary: summarizeLoyaltyNotebookReporting()
    },
    audit: {
      trail: createLoyaltyNotebookAuditTrail(),
      manifest: createLoyaltyNotebookEvidenceManifest(),
      attestation: createLoyaltyNotebookReadinessAttestation()
    },
    playbooks: createLoyaltyNotebookPlaybooks(),
    decisions: createLoyaltyNotebookDecisionDeck(),
    escalationMoments: createLoyaltyNotebookEscalationMoments()
  };
}

export function createLoyaltyNotebookReadinessBoard(snapshot = buildLoyaltyNotebookSnapshot()) {
  return [
    { id: 'loyalty-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyNotebookApiDocument(snapshot = buildLoyaltyNotebookSnapshot()) {
  return {
    id: 'loyalty-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-notebook/overview' },
      { method: 'GET', path: '/api/loyalty-notebook/reporting' },
      { method: 'POST', path: '/api/loyalty-notebook/validate' },
      { method: 'GET', path: '/api/loyalty-notebook/audit' }
    ],
    readiness: createLoyaltyNotebookReadinessBoard(snapshot)
  };
}

export function createLoyaltyNotebookRouteSummary(snapshot = buildLoyaltyNotebookSnapshot()) {
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

