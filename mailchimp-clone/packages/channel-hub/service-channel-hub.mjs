import { createChannelHubWorkspace, summarizeChannelHubWorkspace, createChannelHubNarratives, createChannelHubCoverageGrid } from './domain-channel-hub.mjs';
import { createChannelHubPolicies, validateChannelHubPolicies, summarizeChannelHubPolicies, createChannelHubEscalationDeck } from './policies-channel-hub.mjs';
import { createChannelHubAnalyticsTimeline, createChannelHubForecastEnvelope, createChannelHubExceptionLedger, summarizeChannelHubAnalytics } from './analytics-channel-hub.mjs';
import { createChannelHubOperationsBoard, createChannelHubShiftChecklist, createChannelHubIncidentDeck } from './operations-channel-hub.mjs';
import { createChannelHubReportCards, createChannelHubReviewPackets, summarizeChannelHubReporting } from './reporting-channel-hub.mjs';
import { createChannelHubAuditTrail, createChannelHubEvidenceManifest, createChannelHubReadinessAttestation } from './audit-channel-hub.mjs';
import { createChannelHubPlaybooks, createChannelHubDecisionDeck, createChannelHubEscalationMoments } from './playbooks-channel-hub.mjs';

export function buildChannelHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelHubWorkspace(workspaceName);
  const policies = createChannelHubPolicies();
  return {
    workspace,
    summary: summarizeChannelHubWorkspace(workspace),
    narratives: createChannelHubNarratives(workspace),
    coverage: createChannelHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelHubPolicies(policies),
    validation: validateChannelHubPolicies(policies),
    escalationDeck: createChannelHubEscalationDeck(policies),
    analytics: {
      timeline: createChannelHubAnalyticsTimeline(),
      forecast: createChannelHubForecastEnvelope(),
      exceptions: createChannelHubExceptionLedger(),
      summary: summarizeChannelHubAnalytics()
    },
    operations: {
      board: createChannelHubOperationsBoard(),
      checklist: createChannelHubShiftChecklist(),
      incidents: createChannelHubIncidentDeck()
    },
    reporting: {
      cards: createChannelHubReportCards(),
      packets: createChannelHubReviewPackets(),
      summary: summarizeChannelHubReporting()
    },
    audit: {
      trail: createChannelHubAuditTrail(),
      manifest: createChannelHubEvidenceManifest(),
      attestation: createChannelHubReadinessAttestation()
    },
    playbooks: createChannelHubPlaybooks(),
    decisions: createChannelHubDecisionDeck(),
    escalationMoments: createChannelHubEscalationMoments()
  };
}

export function createChannelHubReadinessBoard(snapshot = buildChannelHubSnapshot()) {
  return [
    { id: 'channel-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelHubApiDocument(snapshot = buildChannelHubSnapshot()) {
  return {
    id: 'channel-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-hub/overview' },
      { method: 'GET', path: '/api/channel-hub/reporting' },
      { method: 'POST', path: '/api/channel-hub/validate' },
      { method: 'GET', path: '/api/channel-hub/audit' }
    ],
    readiness: createChannelHubReadinessBoard(snapshot)
  };
}

export function createChannelHubRouteSummary(snapshot = buildChannelHubSnapshot()) {
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

