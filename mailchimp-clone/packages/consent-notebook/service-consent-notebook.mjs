import { createConsentNotebookWorkspace, summarizeConsentNotebookWorkspace, createConsentNotebookNarratives, createConsentNotebookCoverageGrid } from './domain-consent-notebook.mjs';
import { createConsentNotebookPolicies, validateConsentNotebookPolicies, summarizeConsentNotebookPolicies, createConsentNotebookEscalationDeck } from './policies-consent-notebook.mjs';
import { createConsentNotebookAnalyticsTimeline, createConsentNotebookForecastEnvelope, createConsentNotebookExceptionLedger, summarizeConsentNotebookAnalytics } from './analytics-consent-notebook.mjs';
import { createConsentNotebookOperationsBoard, createConsentNotebookShiftChecklist, createConsentNotebookIncidentDeck } from './operations-consent-notebook.mjs';
import { createConsentNotebookReportCards, createConsentNotebookReviewPackets, summarizeConsentNotebookReporting } from './reporting-consent-notebook.mjs';
import { createConsentNotebookAuditTrail, createConsentNotebookEvidenceManifest, createConsentNotebookReadinessAttestation } from './audit-consent-notebook.mjs';
import { createConsentNotebookPlaybooks, createConsentNotebookDecisionDeck, createConsentNotebookEscalationMoments } from './playbooks-consent-notebook.mjs';

export function buildConsentNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentNotebookWorkspace(workspaceName);
  const policies = createConsentNotebookPolicies();
  return {
    workspace,
    summary: summarizeConsentNotebookWorkspace(workspace),
    narratives: createConsentNotebookNarratives(workspace),
    coverage: createConsentNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentNotebookPolicies(policies),
    validation: validateConsentNotebookPolicies(policies),
    escalationDeck: createConsentNotebookEscalationDeck(policies),
    analytics: {
      timeline: createConsentNotebookAnalyticsTimeline(),
      forecast: createConsentNotebookForecastEnvelope(),
      exceptions: createConsentNotebookExceptionLedger(),
      summary: summarizeConsentNotebookAnalytics()
    },
    operations: {
      board: createConsentNotebookOperationsBoard(),
      checklist: createConsentNotebookShiftChecklist(),
      incidents: createConsentNotebookIncidentDeck()
    },
    reporting: {
      cards: createConsentNotebookReportCards(),
      packets: createConsentNotebookReviewPackets(),
      summary: summarizeConsentNotebookReporting()
    },
    audit: {
      trail: createConsentNotebookAuditTrail(),
      manifest: createConsentNotebookEvidenceManifest(),
      attestation: createConsentNotebookReadinessAttestation()
    },
    playbooks: createConsentNotebookPlaybooks(),
    decisions: createConsentNotebookDecisionDeck(),
    escalationMoments: createConsentNotebookEscalationMoments()
  };
}

export function createConsentNotebookReadinessBoard(snapshot = buildConsentNotebookSnapshot()) {
  return [
    { id: 'consent-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentNotebookApiDocument(snapshot = buildConsentNotebookSnapshot()) {
  return {
    id: 'consent-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-notebook/overview' },
      { method: 'GET', path: '/api/consent-notebook/reporting' },
      { method: 'POST', path: '/api/consent-notebook/validate' },
      { method: 'GET', path: '/api/consent-notebook/audit' }
    ],
    readiness: createConsentNotebookReadinessBoard(snapshot)
  };
}

export function createConsentNotebookRouteSummary(snapshot = buildConsentNotebookSnapshot()) {
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

