import { createChannelCockpitWorkspace, summarizeChannelCockpitWorkspace, createChannelCockpitNarratives, createChannelCockpitCoverageGrid } from './domain-channel-cockpit.mjs';
import { createChannelCockpitPolicies, validateChannelCockpitPolicies, summarizeChannelCockpitPolicies, createChannelCockpitEscalationDeck } from './policies-channel-cockpit.mjs';
import { createChannelCockpitAnalyticsTimeline, createChannelCockpitForecastEnvelope, createChannelCockpitExceptionLedger, summarizeChannelCockpitAnalytics } from './analytics-channel-cockpit.mjs';
import { createChannelCockpitOperationsBoard, createChannelCockpitShiftChecklist, createChannelCockpitIncidentDeck } from './operations-channel-cockpit.mjs';
import { createChannelCockpitReportCards, createChannelCockpitReviewPackets, summarizeChannelCockpitReporting } from './reporting-channel-cockpit.mjs';
import { createChannelCockpitAuditTrail, createChannelCockpitEvidenceManifest, createChannelCockpitReadinessAttestation } from './audit-channel-cockpit.mjs';
import { createChannelCockpitPlaybooks, createChannelCockpitDecisionDeck, createChannelCockpitEscalationMoments } from './playbooks-channel-cockpit.mjs';

export function buildChannelCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelCockpitWorkspace(workspaceName);
  const policies = createChannelCockpitPolicies();
  return {
    workspace,
    summary: summarizeChannelCockpitWorkspace(workspace),
    narratives: createChannelCockpitNarratives(workspace),
    coverage: createChannelCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelCockpitPolicies(policies),
    validation: validateChannelCockpitPolicies(policies),
    escalationDeck: createChannelCockpitEscalationDeck(policies),
    analytics: {
      timeline: createChannelCockpitAnalyticsTimeline(),
      forecast: createChannelCockpitForecastEnvelope(),
      exceptions: createChannelCockpitExceptionLedger(),
      summary: summarizeChannelCockpitAnalytics()
    },
    operations: {
      board: createChannelCockpitOperationsBoard(),
      checklist: createChannelCockpitShiftChecklist(),
      incidents: createChannelCockpitIncidentDeck()
    },
    reporting: {
      cards: createChannelCockpitReportCards(),
      packets: createChannelCockpitReviewPackets(),
      summary: summarizeChannelCockpitReporting()
    },
    audit: {
      trail: createChannelCockpitAuditTrail(),
      manifest: createChannelCockpitEvidenceManifest(),
      attestation: createChannelCockpitReadinessAttestation()
    },
    playbooks: createChannelCockpitPlaybooks(),
    decisions: createChannelCockpitDecisionDeck(),
    escalationMoments: createChannelCockpitEscalationMoments()
  };
}

export function createChannelCockpitReadinessBoard(snapshot = buildChannelCockpitSnapshot()) {
  return [
    { id: 'channel-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelCockpitApiDocument(snapshot = buildChannelCockpitSnapshot()) {
  return {
    id: 'channel-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-cockpit/overview' },
      { method: 'GET', path: '/api/channel-cockpit/reporting' },
      { method: 'POST', path: '/api/channel-cockpit/validate' },
      { method: 'GET', path: '/api/channel-cockpit/audit' }
    ],
    readiness: createChannelCockpitReadinessBoard(snapshot)
  };
}

export function createChannelCockpitRouteSummary(snapshot = buildChannelCockpitSnapshot()) {
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

