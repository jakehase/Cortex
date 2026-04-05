import { createChannelWorkbenchWorkspace, summarizeChannelWorkbenchWorkspace, createChannelWorkbenchNarratives, createChannelWorkbenchCoverageGrid } from './domain-channel-workbench.mjs';
import { createChannelWorkbenchPolicies, validateChannelWorkbenchPolicies, summarizeChannelWorkbenchPolicies, createChannelWorkbenchEscalationDeck } from './policies-channel-workbench.mjs';
import { createChannelWorkbenchAnalyticsTimeline, createChannelWorkbenchForecastEnvelope, createChannelWorkbenchExceptionLedger, summarizeChannelWorkbenchAnalytics } from './analytics-channel-workbench.mjs';
import { createChannelWorkbenchOperationsBoard, createChannelWorkbenchShiftChecklist, createChannelWorkbenchIncidentDeck } from './operations-channel-workbench.mjs';
import { createChannelWorkbenchReportCards, createChannelWorkbenchReviewPackets, summarizeChannelWorkbenchReporting } from './reporting-channel-workbench.mjs';
import { createChannelWorkbenchAuditTrail, createChannelWorkbenchEvidenceManifest, createChannelWorkbenchReadinessAttestation } from './audit-channel-workbench.mjs';
import { createChannelWorkbenchPlaybooks, createChannelWorkbenchDecisionDeck, createChannelWorkbenchEscalationMoments } from './playbooks-channel-workbench.mjs';

export function buildChannelWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelWorkbenchWorkspace(workspaceName);
  const policies = createChannelWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeChannelWorkbenchWorkspace(workspace),
    narratives: createChannelWorkbenchNarratives(workspace),
    coverage: createChannelWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelWorkbenchPolicies(policies),
    validation: validateChannelWorkbenchPolicies(policies),
    escalationDeck: createChannelWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createChannelWorkbenchAnalyticsTimeline(),
      forecast: createChannelWorkbenchForecastEnvelope(),
      exceptions: createChannelWorkbenchExceptionLedger(),
      summary: summarizeChannelWorkbenchAnalytics()
    },
    operations: {
      board: createChannelWorkbenchOperationsBoard(),
      checklist: createChannelWorkbenchShiftChecklist(),
      incidents: createChannelWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createChannelWorkbenchReportCards(),
      packets: createChannelWorkbenchReviewPackets(),
      summary: summarizeChannelWorkbenchReporting()
    },
    audit: {
      trail: createChannelWorkbenchAuditTrail(),
      manifest: createChannelWorkbenchEvidenceManifest(),
      attestation: createChannelWorkbenchReadinessAttestation()
    },
    playbooks: createChannelWorkbenchPlaybooks(),
    decisions: createChannelWorkbenchDecisionDeck(),
    escalationMoments: createChannelWorkbenchEscalationMoments()
  };
}

export function createChannelWorkbenchReadinessBoard(snapshot = buildChannelWorkbenchSnapshot()) {
  return [
    { id: 'channel-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelWorkbenchApiDocument(snapshot = buildChannelWorkbenchSnapshot()) {
  return {
    id: 'channel-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-workbench/overview' },
      { method: 'GET', path: '/api/channel-workbench/reporting' },
      { method: 'POST', path: '/api/channel-workbench/validate' },
      { method: 'GET', path: '/api/channel-workbench/audit' }
    ],
    readiness: createChannelWorkbenchReadinessBoard(snapshot)
  };
}

export function createChannelWorkbenchRouteSummary(snapshot = buildChannelWorkbenchSnapshot()) {
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

