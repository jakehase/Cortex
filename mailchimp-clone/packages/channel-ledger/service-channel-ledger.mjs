import { createChannelLedgerWorkspace, summarizeChannelLedgerWorkspace, createChannelLedgerNarratives, createChannelLedgerCoverageGrid } from './domain-channel-ledger.mjs';
import { createChannelLedgerPolicies, validateChannelLedgerPolicies, summarizeChannelLedgerPolicies, createChannelLedgerEscalationDeck } from './policies-channel-ledger.mjs';
import { createChannelLedgerAnalyticsTimeline, createChannelLedgerForecastEnvelope, createChannelLedgerExceptionLedger, summarizeChannelLedgerAnalytics } from './analytics-channel-ledger.mjs';
import { createChannelLedgerOperationsBoard, createChannelLedgerShiftChecklist, createChannelLedgerIncidentDeck } from './operations-channel-ledger.mjs';
import { createChannelLedgerReportCards, createChannelLedgerReviewPackets, summarizeChannelLedgerReporting } from './reporting-channel-ledger.mjs';
import { createChannelLedgerAuditTrail, createChannelLedgerEvidenceManifest, createChannelLedgerReadinessAttestation } from './audit-channel-ledger.mjs';
import { createChannelLedgerPlaybooks, createChannelLedgerDecisionDeck, createChannelLedgerEscalationMoments } from './playbooks-channel-ledger.mjs';

export function buildChannelLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelLedgerWorkspace(workspaceName);
  const policies = createChannelLedgerPolicies();
  return {
    workspace,
    summary: summarizeChannelLedgerWorkspace(workspace),
    narratives: createChannelLedgerNarratives(workspace),
    coverage: createChannelLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelLedgerPolicies(policies),
    validation: validateChannelLedgerPolicies(policies),
    escalationDeck: createChannelLedgerEscalationDeck(policies),
    analytics: {
      timeline: createChannelLedgerAnalyticsTimeline(),
      forecast: createChannelLedgerForecastEnvelope(),
      exceptions: createChannelLedgerExceptionLedger(),
      summary: summarizeChannelLedgerAnalytics()
    },
    operations: {
      board: createChannelLedgerOperationsBoard(),
      checklist: createChannelLedgerShiftChecklist(),
      incidents: createChannelLedgerIncidentDeck()
    },
    reporting: {
      cards: createChannelLedgerReportCards(),
      packets: createChannelLedgerReviewPackets(),
      summary: summarizeChannelLedgerReporting()
    },
    audit: {
      trail: createChannelLedgerAuditTrail(),
      manifest: createChannelLedgerEvidenceManifest(),
      attestation: createChannelLedgerReadinessAttestation()
    },
    playbooks: createChannelLedgerPlaybooks(),
    decisions: createChannelLedgerDecisionDeck(),
    escalationMoments: createChannelLedgerEscalationMoments()
  };
}

export function createChannelLedgerReadinessBoard(snapshot = buildChannelLedgerSnapshot()) {
  return [
    { id: 'channel-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelLedgerApiDocument(snapshot = buildChannelLedgerSnapshot()) {
  return {
    id: 'channel-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-ledger/overview' },
      { method: 'GET', path: '/api/channel-ledger/reporting' },
      { method: 'POST', path: '/api/channel-ledger/validate' },
      { method: 'GET', path: '/api/channel-ledger/audit' }
    ],
    readiness: createChannelLedgerReadinessBoard(snapshot)
  };
}

export function createChannelLedgerRouteSummary(snapshot = buildChannelLedgerSnapshot()) {
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

