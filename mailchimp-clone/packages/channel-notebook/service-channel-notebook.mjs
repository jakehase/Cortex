import { createChannelNotebookWorkspace, summarizeChannelNotebookWorkspace, createChannelNotebookNarratives, createChannelNotebookCoverageGrid } from './domain-channel-notebook.mjs';
import { createChannelNotebookPolicies, validateChannelNotebookPolicies, summarizeChannelNotebookPolicies, createChannelNotebookEscalationDeck } from './policies-channel-notebook.mjs';
import { createChannelNotebookAnalyticsTimeline, createChannelNotebookForecastEnvelope, createChannelNotebookExceptionLedger, summarizeChannelNotebookAnalytics } from './analytics-channel-notebook.mjs';
import { createChannelNotebookOperationsBoard, createChannelNotebookShiftChecklist, createChannelNotebookIncidentDeck } from './operations-channel-notebook.mjs';
import { createChannelNotebookReportCards, createChannelNotebookReviewPackets, summarizeChannelNotebookReporting } from './reporting-channel-notebook.mjs';
import { createChannelNotebookAuditTrail, createChannelNotebookEvidenceManifest, createChannelNotebookReadinessAttestation } from './audit-channel-notebook.mjs';
import { createChannelNotebookPlaybooks, createChannelNotebookDecisionDeck, createChannelNotebookEscalationMoments } from './playbooks-channel-notebook.mjs';

export function buildChannelNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelNotebookWorkspace(workspaceName);
  const policies = createChannelNotebookPolicies();
  return {
    workspace,
    summary: summarizeChannelNotebookWorkspace(workspace),
    narratives: createChannelNotebookNarratives(workspace),
    coverage: createChannelNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelNotebookPolicies(policies),
    validation: validateChannelNotebookPolicies(policies),
    escalationDeck: createChannelNotebookEscalationDeck(policies),
    analytics: {
      timeline: createChannelNotebookAnalyticsTimeline(),
      forecast: createChannelNotebookForecastEnvelope(),
      exceptions: createChannelNotebookExceptionLedger(),
      summary: summarizeChannelNotebookAnalytics()
    },
    operations: {
      board: createChannelNotebookOperationsBoard(),
      checklist: createChannelNotebookShiftChecklist(),
      incidents: createChannelNotebookIncidentDeck()
    },
    reporting: {
      cards: createChannelNotebookReportCards(),
      packets: createChannelNotebookReviewPackets(),
      summary: summarizeChannelNotebookReporting()
    },
    audit: {
      trail: createChannelNotebookAuditTrail(),
      manifest: createChannelNotebookEvidenceManifest(),
      attestation: createChannelNotebookReadinessAttestation()
    },
    playbooks: createChannelNotebookPlaybooks(),
    decisions: createChannelNotebookDecisionDeck(),
    escalationMoments: createChannelNotebookEscalationMoments()
  };
}

export function createChannelNotebookReadinessBoard(snapshot = buildChannelNotebookSnapshot()) {
  return [
    { id: 'channel-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelNotebookApiDocument(snapshot = buildChannelNotebookSnapshot()) {
  return {
    id: 'channel-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-notebook/overview' },
      { method: 'GET', path: '/api/channel-notebook/reporting' },
      { method: 'POST', path: '/api/channel-notebook/validate' },
      { method: 'GET', path: '/api/channel-notebook/audit' }
    ],
    readiness: createChannelNotebookReadinessBoard(snapshot)
  };
}

export function createChannelNotebookRouteSummary(snapshot = buildChannelNotebookSnapshot()) {
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

