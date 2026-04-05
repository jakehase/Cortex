import { createLocalizationNotebookWorkspace, summarizeLocalizationNotebookWorkspace, createLocalizationNotebookNarratives, createLocalizationNotebookCoverageGrid } from './domain-localization-notebook.mjs';
import { createLocalizationNotebookPolicies, validateLocalizationNotebookPolicies, summarizeLocalizationNotebookPolicies, createLocalizationNotebookEscalationDeck } from './policies-localization-notebook.mjs';
import { createLocalizationNotebookAnalyticsTimeline, createLocalizationNotebookForecastEnvelope, createLocalizationNotebookExceptionLedger, summarizeLocalizationNotebookAnalytics } from './analytics-localization-notebook.mjs';
import { createLocalizationNotebookOperationsBoard, createLocalizationNotebookShiftChecklist, createLocalizationNotebookIncidentDeck } from './operations-localization-notebook.mjs';
import { createLocalizationNotebookReportCards, createLocalizationNotebookReviewPackets, summarizeLocalizationNotebookReporting } from './reporting-localization-notebook.mjs';
import { createLocalizationNotebookAuditTrail, createLocalizationNotebookEvidenceManifest, createLocalizationNotebookReadinessAttestation } from './audit-localization-notebook.mjs';
import { createLocalizationNotebookPlaybooks, createLocalizationNotebookDecisionDeck, createLocalizationNotebookEscalationMoments } from './playbooks-localization-notebook.mjs';

export function buildLocalizationNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationNotebookWorkspace(workspaceName);
  const policies = createLocalizationNotebookPolicies();
  return {
    workspace,
    summary: summarizeLocalizationNotebookWorkspace(workspace),
    narratives: createLocalizationNotebookNarratives(workspace),
    coverage: createLocalizationNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationNotebookPolicies(policies),
    validation: validateLocalizationNotebookPolicies(policies),
    escalationDeck: createLocalizationNotebookEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationNotebookAnalyticsTimeline(),
      forecast: createLocalizationNotebookForecastEnvelope(),
      exceptions: createLocalizationNotebookExceptionLedger(),
      summary: summarizeLocalizationNotebookAnalytics()
    },
    operations: {
      board: createLocalizationNotebookOperationsBoard(),
      checklist: createLocalizationNotebookShiftChecklist(),
      incidents: createLocalizationNotebookIncidentDeck()
    },
    reporting: {
      cards: createLocalizationNotebookReportCards(),
      packets: createLocalizationNotebookReviewPackets(),
      summary: summarizeLocalizationNotebookReporting()
    },
    audit: {
      trail: createLocalizationNotebookAuditTrail(),
      manifest: createLocalizationNotebookEvidenceManifest(),
      attestation: createLocalizationNotebookReadinessAttestation()
    },
    playbooks: createLocalizationNotebookPlaybooks(),
    decisions: createLocalizationNotebookDecisionDeck(),
    escalationMoments: createLocalizationNotebookEscalationMoments()
  };
}

export function createLocalizationNotebookReadinessBoard(snapshot = buildLocalizationNotebookSnapshot()) {
  return [
    { id: 'localization-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationNotebookApiDocument(snapshot = buildLocalizationNotebookSnapshot()) {
  return {
    id: 'localization-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-notebook/overview' },
      { method: 'GET', path: '/api/localization-notebook/reporting' },
      { method: 'POST', path: '/api/localization-notebook/validate' },
      { method: 'GET', path: '/api/localization-notebook/audit' }
    ],
    readiness: createLocalizationNotebookReadinessBoard(snapshot)
  };
}

export function createLocalizationNotebookRouteSummary(snapshot = buildLocalizationNotebookSnapshot()) {
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

