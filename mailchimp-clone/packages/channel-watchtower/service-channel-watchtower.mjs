import { createChannelWatchtowerWorkspace, summarizeChannelWatchtowerWorkspace, createChannelWatchtowerNarratives, createChannelWatchtowerCoverageGrid } from './domain-channel-watchtower.mjs';
import { createChannelWatchtowerPolicies, validateChannelWatchtowerPolicies, summarizeChannelWatchtowerPolicies, createChannelWatchtowerEscalationDeck } from './policies-channel-watchtower.mjs';
import { createChannelWatchtowerAnalyticsTimeline, createChannelWatchtowerForecastEnvelope, createChannelWatchtowerExceptionLedger, summarizeChannelWatchtowerAnalytics } from './analytics-channel-watchtower.mjs';
import { createChannelWatchtowerOperationsBoard, createChannelWatchtowerShiftChecklist, createChannelWatchtowerIncidentDeck } from './operations-channel-watchtower.mjs';
import { createChannelWatchtowerReportCards, createChannelWatchtowerReviewPackets, summarizeChannelWatchtowerReporting } from './reporting-channel-watchtower.mjs';
import { createChannelWatchtowerAuditTrail, createChannelWatchtowerEvidenceManifest, createChannelWatchtowerReadinessAttestation } from './audit-channel-watchtower.mjs';
import { createChannelWatchtowerPlaybooks, createChannelWatchtowerDecisionDeck, createChannelWatchtowerEscalationMoments } from './playbooks-channel-watchtower.mjs';

export function buildChannelWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelWatchtowerWorkspace(workspaceName);
  const policies = createChannelWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeChannelWatchtowerWorkspace(workspace),
    narratives: createChannelWatchtowerNarratives(workspace),
    coverage: createChannelWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelWatchtowerPolicies(policies),
    validation: validateChannelWatchtowerPolicies(policies),
    escalationDeck: createChannelWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createChannelWatchtowerAnalyticsTimeline(),
      forecast: createChannelWatchtowerForecastEnvelope(),
      exceptions: createChannelWatchtowerExceptionLedger(),
      summary: summarizeChannelWatchtowerAnalytics()
    },
    operations: {
      board: createChannelWatchtowerOperationsBoard(),
      checklist: createChannelWatchtowerShiftChecklist(),
      incidents: createChannelWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createChannelWatchtowerReportCards(),
      packets: createChannelWatchtowerReviewPackets(),
      summary: summarizeChannelWatchtowerReporting()
    },
    audit: {
      trail: createChannelWatchtowerAuditTrail(),
      manifest: createChannelWatchtowerEvidenceManifest(),
      attestation: createChannelWatchtowerReadinessAttestation()
    },
    playbooks: createChannelWatchtowerPlaybooks(),
    decisions: createChannelWatchtowerDecisionDeck(),
    escalationMoments: createChannelWatchtowerEscalationMoments()
  };
}

export function createChannelWatchtowerReadinessBoard(snapshot = buildChannelWatchtowerSnapshot()) {
  return [
    { id: 'channel-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelWatchtowerApiDocument(snapshot = buildChannelWatchtowerSnapshot()) {
  return {
    id: 'channel-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-watchtower/overview' },
      { method: 'GET', path: '/api/channel-watchtower/reporting' },
      { method: 'POST', path: '/api/channel-watchtower/validate' },
      { method: 'GET', path: '/api/channel-watchtower/audit' }
    ],
    readiness: createChannelWatchtowerReadinessBoard(snapshot)
  };
}

export function createChannelWatchtowerRouteSummary(snapshot = buildChannelWatchtowerSnapshot()) {
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

