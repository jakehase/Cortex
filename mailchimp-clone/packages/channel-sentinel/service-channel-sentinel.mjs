import { createChannelSentinelWorkspace, summarizeChannelSentinelWorkspace, createChannelSentinelNarratives, createChannelSentinelCoverageGrid } from './domain-channel-sentinel.mjs';
import { createChannelSentinelPolicies, validateChannelSentinelPolicies, summarizeChannelSentinelPolicies, createChannelSentinelEscalationDeck } from './policies-channel-sentinel.mjs';
import { createChannelSentinelAnalyticsTimeline, createChannelSentinelForecastEnvelope, createChannelSentinelExceptionLedger, summarizeChannelSentinelAnalytics } from './analytics-channel-sentinel.mjs';
import { createChannelSentinelOperationsBoard, createChannelSentinelShiftChecklist, createChannelSentinelIncidentDeck } from './operations-channel-sentinel.mjs';
import { createChannelSentinelReportCards, createChannelSentinelReviewPackets, summarizeChannelSentinelReporting } from './reporting-channel-sentinel.mjs';
import { createChannelSentinelAuditTrail, createChannelSentinelEvidenceManifest, createChannelSentinelReadinessAttestation } from './audit-channel-sentinel.mjs';
import { createChannelSentinelPlaybooks, createChannelSentinelDecisionDeck, createChannelSentinelEscalationMoments } from './playbooks-channel-sentinel.mjs';

export function buildChannelSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelSentinelWorkspace(workspaceName);
  const policies = createChannelSentinelPolicies();
  return {
    workspace,
    summary: summarizeChannelSentinelWorkspace(workspace),
    narratives: createChannelSentinelNarratives(workspace),
    coverage: createChannelSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelSentinelPolicies(policies),
    validation: validateChannelSentinelPolicies(policies),
    escalationDeck: createChannelSentinelEscalationDeck(policies),
    analytics: {
      timeline: createChannelSentinelAnalyticsTimeline(),
      forecast: createChannelSentinelForecastEnvelope(),
      exceptions: createChannelSentinelExceptionLedger(),
      summary: summarizeChannelSentinelAnalytics()
    },
    operations: {
      board: createChannelSentinelOperationsBoard(),
      checklist: createChannelSentinelShiftChecklist(),
      incidents: createChannelSentinelIncidentDeck()
    },
    reporting: {
      cards: createChannelSentinelReportCards(),
      packets: createChannelSentinelReviewPackets(),
      summary: summarizeChannelSentinelReporting()
    },
    audit: {
      trail: createChannelSentinelAuditTrail(),
      manifest: createChannelSentinelEvidenceManifest(),
      attestation: createChannelSentinelReadinessAttestation()
    },
    playbooks: createChannelSentinelPlaybooks(),
    decisions: createChannelSentinelDecisionDeck(),
    escalationMoments: createChannelSentinelEscalationMoments()
  };
}

export function createChannelSentinelReadinessBoard(snapshot = buildChannelSentinelSnapshot()) {
  return [
    { id: 'channel-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelSentinelApiDocument(snapshot = buildChannelSentinelSnapshot()) {
  return {
    id: 'channel-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-sentinel/overview' },
      { method: 'GET', path: '/api/channel-sentinel/reporting' },
      { method: 'POST', path: '/api/channel-sentinel/validate' },
      { method: 'GET', path: '/api/channel-sentinel/audit' }
    ],
    readiness: createChannelSentinelReadinessBoard(snapshot)
  };
}

export function createChannelSentinelRouteSummary(snapshot = buildChannelSentinelSnapshot()) {
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

