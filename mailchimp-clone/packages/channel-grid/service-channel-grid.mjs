import { createChannelGridWorkspace, summarizeChannelGridWorkspace, createChannelGridNarratives, createChannelGridCoverageGrid } from './domain-channel-grid.mjs';
import { createChannelGridPolicies, validateChannelGridPolicies, summarizeChannelGridPolicies, createChannelGridEscalationDeck } from './policies-channel-grid.mjs';
import { createChannelGridAnalyticsTimeline, createChannelGridForecastEnvelope, createChannelGridExceptionLedger, summarizeChannelGridAnalytics } from './analytics-channel-grid.mjs';
import { createChannelGridOperationsBoard, createChannelGridShiftChecklist, createChannelGridIncidentDeck } from './operations-channel-grid.mjs';
import { createChannelGridReportCards, createChannelGridReviewPackets, summarizeChannelGridReporting } from './reporting-channel-grid.mjs';
import { createChannelGridAuditTrail, createChannelGridEvidenceManifest, createChannelGridReadinessAttestation } from './audit-channel-grid.mjs';
import { createChannelGridPlaybooks, createChannelGridDecisionDeck, createChannelGridEscalationMoments } from './playbooks-channel-grid.mjs';

export function buildChannelGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelGridWorkspace(workspaceName);
  const policies = createChannelGridPolicies();
  return {
    workspace,
    summary: summarizeChannelGridWorkspace(workspace),
    narratives: createChannelGridNarratives(workspace),
    coverage: createChannelGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelGridPolicies(policies),
    validation: validateChannelGridPolicies(policies),
    escalationDeck: createChannelGridEscalationDeck(policies),
    analytics: {
      timeline: createChannelGridAnalyticsTimeline(),
      forecast: createChannelGridForecastEnvelope(),
      exceptions: createChannelGridExceptionLedger(),
      summary: summarizeChannelGridAnalytics()
    },
    operations: {
      board: createChannelGridOperationsBoard(),
      checklist: createChannelGridShiftChecklist(),
      incidents: createChannelGridIncidentDeck()
    },
    reporting: {
      cards: createChannelGridReportCards(),
      packets: createChannelGridReviewPackets(),
      summary: summarizeChannelGridReporting()
    },
    audit: {
      trail: createChannelGridAuditTrail(),
      manifest: createChannelGridEvidenceManifest(),
      attestation: createChannelGridReadinessAttestation()
    },
    playbooks: createChannelGridPlaybooks(),
    decisions: createChannelGridDecisionDeck(),
    escalationMoments: createChannelGridEscalationMoments()
  };
}

export function createChannelGridReadinessBoard(snapshot = buildChannelGridSnapshot()) {
  return [
    { id: 'channel-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelGridApiDocument(snapshot = buildChannelGridSnapshot()) {
  return {
    id: 'channel-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-grid/overview' },
      { method: 'GET', path: '/api/channel-grid/reporting' },
      { method: 'POST', path: '/api/channel-grid/validate' },
      { method: 'GET', path: '/api/channel-grid/audit' }
    ],
    readiness: createChannelGridReadinessBoard(snapshot)
  };
}

export function createChannelGridRouteSummary(snapshot = buildChannelGridSnapshot()) {
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

