import { createChannelIndexWorkspace, summarizeChannelIndexWorkspace, createChannelIndexNarratives, createChannelIndexCoverageGrid } from './domain-channel-index.mjs';
import { createChannelIndexPolicies, validateChannelIndexPolicies, summarizeChannelIndexPolicies, createChannelIndexEscalationDeck } from './policies-channel-index.mjs';
import { createChannelIndexAnalyticsTimeline, createChannelIndexForecastEnvelope, createChannelIndexExceptionLedger, summarizeChannelIndexAnalytics } from './analytics-channel-index.mjs';
import { createChannelIndexOperationsBoard, createChannelIndexShiftChecklist, createChannelIndexIncidentDeck } from './operations-channel-index.mjs';
import { createChannelIndexReportCards, createChannelIndexReviewPackets, summarizeChannelIndexReporting } from './reporting-channel-index.mjs';
import { createChannelIndexAuditTrail, createChannelIndexEvidenceManifest, createChannelIndexReadinessAttestation } from './audit-channel-index.mjs';
import { createChannelIndexPlaybooks, createChannelIndexDecisionDeck, createChannelIndexEscalationMoments } from './playbooks-channel-index.mjs';

export function buildChannelIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelIndexWorkspace(workspaceName);
  const policies = createChannelIndexPolicies();
  return {
    workspace,
    summary: summarizeChannelIndexWorkspace(workspace),
    narratives: createChannelIndexNarratives(workspace),
    coverage: createChannelIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelIndexPolicies(policies),
    validation: validateChannelIndexPolicies(policies),
    escalationDeck: createChannelIndexEscalationDeck(policies),
    analytics: {
      timeline: createChannelIndexAnalyticsTimeline(),
      forecast: createChannelIndexForecastEnvelope(),
      exceptions: createChannelIndexExceptionLedger(),
      summary: summarizeChannelIndexAnalytics()
    },
    operations: {
      board: createChannelIndexOperationsBoard(),
      checklist: createChannelIndexShiftChecklist(),
      incidents: createChannelIndexIncidentDeck()
    },
    reporting: {
      cards: createChannelIndexReportCards(),
      packets: createChannelIndexReviewPackets(),
      summary: summarizeChannelIndexReporting()
    },
    audit: {
      trail: createChannelIndexAuditTrail(),
      manifest: createChannelIndexEvidenceManifest(),
      attestation: createChannelIndexReadinessAttestation()
    },
    playbooks: createChannelIndexPlaybooks(),
    decisions: createChannelIndexDecisionDeck(),
    escalationMoments: createChannelIndexEscalationMoments()
  };
}

export function createChannelIndexReadinessBoard(snapshot = buildChannelIndexSnapshot()) {
  return [
    { id: 'channel-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelIndexApiDocument(snapshot = buildChannelIndexSnapshot()) {
  return {
    id: 'channel-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-index/overview' },
      { method: 'GET', path: '/api/channel-index/reporting' },
      { method: 'POST', path: '/api/channel-index/validate' },
      { method: 'GET', path: '/api/channel-index/audit' }
    ],
    readiness: createChannelIndexReadinessBoard(snapshot)
  };
}

export function createChannelIndexRouteSummary(snapshot = buildChannelIndexSnapshot()) {
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

