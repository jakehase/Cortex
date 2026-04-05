import { createChannelStudioWorkspace, summarizeChannelStudioWorkspace, createChannelStudioNarratives, createChannelStudioCoverageGrid } from './domain-channel-studio.mjs';
import { createChannelStudioPolicies, validateChannelStudioPolicies, summarizeChannelStudioPolicies, createChannelStudioEscalationDeck } from './policies-channel-studio.mjs';
import { createChannelStudioAnalyticsTimeline, createChannelStudioForecastEnvelope, createChannelStudioExceptionLedger, summarizeChannelStudioAnalytics } from './analytics-channel-studio.mjs';
import { createChannelStudioOperationsBoard, createChannelStudioShiftChecklist, createChannelStudioIncidentDeck } from './operations-channel-studio.mjs';
import { createChannelStudioReportCards, createChannelStudioReviewPackets, summarizeChannelStudioReporting } from './reporting-channel-studio.mjs';
import { createChannelStudioAuditTrail, createChannelStudioEvidenceManifest, createChannelStudioReadinessAttestation } from './audit-channel-studio.mjs';
import { createChannelStudioPlaybooks, createChannelStudioDecisionDeck, createChannelStudioEscalationMoments } from './playbooks-channel-studio.mjs';

export function buildChannelStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelStudioWorkspace(workspaceName);
  const policies = createChannelStudioPolicies();
  return {
    workspace,
    summary: summarizeChannelStudioWorkspace(workspace),
    narratives: createChannelStudioNarratives(workspace),
    coverage: createChannelStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelStudioPolicies(policies),
    validation: validateChannelStudioPolicies(policies),
    escalationDeck: createChannelStudioEscalationDeck(policies),
    analytics: {
      timeline: createChannelStudioAnalyticsTimeline(),
      forecast: createChannelStudioForecastEnvelope(),
      exceptions: createChannelStudioExceptionLedger(),
      summary: summarizeChannelStudioAnalytics()
    },
    operations: {
      board: createChannelStudioOperationsBoard(),
      checklist: createChannelStudioShiftChecklist(),
      incidents: createChannelStudioIncidentDeck()
    },
    reporting: {
      cards: createChannelStudioReportCards(),
      packets: createChannelStudioReviewPackets(),
      summary: summarizeChannelStudioReporting()
    },
    audit: {
      trail: createChannelStudioAuditTrail(),
      manifest: createChannelStudioEvidenceManifest(),
      attestation: createChannelStudioReadinessAttestation()
    },
    playbooks: createChannelStudioPlaybooks(),
    decisions: createChannelStudioDecisionDeck(),
    escalationMoments: createChannelStudioEscalationMoments()
  };
}

export function createChannelStudioReadinessBoard(snapshot = buildChannelStudioSnapshot()) {
  return [
    { id: 'channel-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelStudioApiDocument(snapshot = buildChannelStudioSnapshot()) {
  return {
    id: 'channel-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-studio/overview' },
      { method: 'GET', path: '/api/channel-studio/reporting' },
      { method: 'POST', path: '/api/channel-studio/validate' },
      { method: 'GET', path: '/api/channel-studio/audit' }
    ],
    readiness: createChannelStudioReadinessBoard(snapshot)
  };
}

export function createChannelStudioRouteSummary(snapshot = buildChannelStudioSnapshot()) {
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

