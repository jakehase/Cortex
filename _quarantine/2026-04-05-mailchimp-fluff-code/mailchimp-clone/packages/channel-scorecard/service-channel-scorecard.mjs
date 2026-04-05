import { createChannelScorecardWorkspace, summarizeChannelScorecardWorkspace, createChannelScorecardNarratives, createChannelScorecardCoverageGrid } from './domain-channel-scorecard.mjs';
import { createChannelScorecardPolicies, validateChannelScorecardPolicies, summarizeChannelScorecardPolicies, createChannelScorecardEscalationDeck } from './policies-channel-scorecard.mjs';
import { createChannelScorecardAnalyticsTimeline, createChannelScorecardForecastEnvelope, createChannelScorecardExceptionLedger, summarizeChannelScorecardAnalytics } from './analytics-channel-scorecard.mjs';
import { createChannelScorecardOperationsBoard, createChannelScorecardShiftChecklist, createChannelScorecardIncidentDeck } from './operations-channel-scorecard.mjs';
import { createChannelScorecardReportCards, createChannelScorecardReviewPackets, summarizeChannelScorecardReporting } from './reporting-channel-scorecard.mjs';
import { createChannelScorecardAuditTrail, createChannelScorecardEvidenceManifest, createChannelScorecardReadinessAttestation } from './audit-channel-scorecard.mjs';
import { createChannelScorecardPlaybooks, createChannelScorecardDecisionDeck, createChannelScorecardEscalationMoments } from './playbooks-channel-scorecard.mjs';

export function buildChannelScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelScorecardWorkspace(workspaceName);
  const policies = createChannelScorecardPolicies();
  return {
    workspace,
    summary: summarizeChannelScorecardWorkspace(workspace),
    narratives: createChannelScorecardNarratives(workspace),
    coverage: createChannelScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelScorecardPolicies(policies),
    validation: validateChannelScorecardPolicies(policies),
    escalationDeck: createChannelScorecardEscalationDeck(policies),
    analytics: {
      timeline: createChannelScorecardAnalyticsTimeline(),
      forecast: createChannelScorecardForecastEnvelope(),
      exceptions: createChannelScorecardExceptionLedger(),
      summary: summarizeChannelScorecardAnalytics()
    },
    operations: {
      board: createChannelScorecardOperationsBoard(),
      checklist: createChannelScorecardShiftChecklist(),
      incidents: createChannelScorecardIncidentDeck()
    },
    reporting: {
      cards: createChannelScorecardReportCards(),
      packets: createChannelScorecardReviewPackets(),
      summary: summarizeChannelScorecardReporting()
    },
    audit: {
      trail: createChannelScorecardAuditTrail(),
      manifest: createChannelScorecardEvidenceManifest(),
      attestation: createChannelScorecardReadinessAttestation()
    },
    playbooks: createChannelScorecardPlaybooks(),
    decisions: createChannelScorecardDecisionDeck(),
    escalationMoments: createChannelScorecardEscalationMoments()
  };
}

export function createChannelScorecardReadinessBoard(snapshot = buildChannelScorecardSnapshot()) {
  return [
    { id: 'channel-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelScorecardApiDocument(snapshot = buildChannelScorecardSnapshot()) {
  return {
    id: 'channel-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-scorecard/overview' },
      { method: 'GET', path: '/api/channel-scorecard/reporting' },
      { method: 'POST', path: '/api/channel-scorecard/validate' },
      { method: 'GET', path: '/api/channel-scorecard/audit' }
    ],
    readiness: createChannelScorecardReadinessBoard(snapshot)
  };
}

export function createChannelScorecardRouteSummary(snapshot = buildChannelScorecardSnapshot()) {
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

