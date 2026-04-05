import { createChannelExchangeWorkspace, summarizeChannelExchangeWorkspace, createChannelExchangeNarratives, createChannelExchangeCoverageGrid } from './domain-channel-exchange.mjs';
import { createChannelExchangePolicies, validateChannelExchangePolicies, summarizeChannelExchangePolicies, createChannelExchangeEscalationDeck } from './policies-channel-exchange.mjs';
import { createChannelExchangeAnalyticsTimeline, createChannelExchangeForecastEnvelope, createChannelExchangeExceptionLedger, summarizeChannelExchangeAnalytics } from './analytics-channel-exchange.mjs';
import { createChannelExchangeOperationsBoard, createChannelExchangeShiftChecklist, createChannelExchangeIncidentDeck } from './operations-channel-exchange.mjs';
import { createChannelExchangeReportCards, createChannelExchangeReviewPackets, summarizeChannelExchangeReporting } from './reporting-channel-exchange.mjs';
import { createChannelExchangeAuditTrail, createChannelExchangeEvidenceManifest, createChannelExchangeReadinessAttestation } from './audit-channel-exchange.mjs';
import { createChannelExchangePlaybooks, createChannelExchangeDecisionDeck, createChannelExchangeEscalationMoments } from './playbooks-channel-exchange.mjs';

export function buildChannelExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelExchangeWorkspace(workspaceName);
  const policies = createChannelExchangePolicies();
  return {
    workspace,
    summary: summarizeChannelExchangeWorkspace(workspace),
    narratives: createChannelExchangeNarratives(workspace),
    coverage: createChannelExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelExchangePolicies(policies),
    validation: validateChannelExchangePolicies(policies),
    escalationDeck: createChannelExchangeEscalationDeck(policies),
    analytics: {
      timeline: createChannelExchangeAnalyticsTimeline(),
      forecast: createChannelExchangeForecastEnvelope(),
      exceptions: createChannelExchangeExceptionLedger(),
      summary: summarizeChannelExchangeAnalytics()
    },
    operations: {
      board: createChannelExchangeOperationsBoard(),
      checklist: createChannelExchangeShiftChecklist(),
      incidents: createChannelExchangeIncidentDeck()
    },
    reporting: {
      cards: createChannelExchangeReportCards(),
      packets: createChannelExchangeReviewPackets(),
      summary: summarizeChannelExchangeReporting()
    },
    audit: {
      trail: createChannelExchangeAuditTrail(),
      manifest: createChannelExchangeEvidenceManifest(),
      attestation: createChannelExchangeReadinessAttestation()
    },
    playbooks: createChannelExchangePlaybooks(),
    decisions: createChannelExchangeDecisionDeck(),
    escalationMoments: createChannelExchangeEscalationMoments()
  };
}

export function createChannelExchangeReadinessBoard(snapshot = buildChannelExchangeSnapshot()) {
  return [
    { id: 'channel-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelExchangeApiDocument(snapshot = buildChannelExchangeSnapshot()) {
  return {
    id: 'channel-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-exchange/overview' },
      { method: 'GET', path: '/api/channel-exchange/reporting' },
      { method: 'POST', path: '/api/channel-exchange/validate' },
      { method: 'GET', path: '/api/channel-exchange/audit' }
    ],
    readiness: createChannelExchangeReadinessBoard(snapshot)
  };
}

export function createChannelExchangeRouteSummary(snapshot = buildChannelExchangeSnapshot()) {
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

