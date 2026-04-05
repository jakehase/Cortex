import { createChannelNavigatorWorkspace, summarizeChannelNavigatorWorkspace, createChannelNavigatorNarratives, createChannelNavigatorCoverageGrid } from './domain-channel-navigator.mjs';
import { createChannelNavigatorPolicies, validateChannelNavigatorPolicies, summarizeChannelNavigatorPolicies, createChannelNavigatorEscalationDeck } from './policies-channel-navigator.mjs';
import { createChannelNavigatorAnalyticsTimeline, createChannelNavigatorForecastEnvelope, createChannelNavigatorExceptionLedger, summarizeChannelNavigatorAnalytics } from './analytics-channel-navigator.mjs';
import { createChannelNavigatorOperationsBoard, createChannelNavigatorShiftChecklist, createChannelNavigatorIncidentDeck } from './operations-channel-navigator.mjs';
import { createChannelNavigatorReportCards, createChannelNavigatorReviewPackets, summarizeChannelNavigatorReporting } from './reporting-channel-navigator.mjs';
import { createChannelNavigatorAuditTrail, createChannelNavigatorEvidenceManifest, createChannelNavigatorReadinessAttestation } from './audit-channel-navigator.mjs';
import { createChannelNavigatorPlaybooks, createChannelNavigatorDecisionDeck, createChannelNavigatorEscalationMoments } from './playbooks-channel-navigator.mjs';

export function buildChannelNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelNavigatorWorkspace(workspaceName);
  const policies = createChannelNavigatorPolicies();
  return {
    workspace,
    summary: summarizeChannelNavigatorWorkspace(workspace),
    narratives: createChannelNavigatorNarratives(workspace),
    coverage: createChannelNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelNavigatorPolicies(policies),
    validation: validateChannelNavigatorPolicies(policies),
    escalationDeck: createChannelNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createChannelNavigatorAnalyticsTimeline(),
      forecast: createChannelNavigatorForecastEnvelope(),
      exceptions: createChannelNavigatorExceptionLedger(),
      summary: summarizeChannelNavigatorAnalytics()
    },
    operations: {
      board: createChannelNavigatorOperationsBoard(),
      checklist: createChannelNavigatorShiftChecklist(),
      incidents: createChannelNavigatorIncidentDeck()
    },
    reporting: {
      cards: createChannelNavigatorReportCards(),
      packets: createChannelNavigatorReviewPackets(),
      summary: summarizeChannelNavigatorReporting()
    },
    audit: {
      trail: createChannelNavigatorAuditTrail(),
      manifest: createChannelNavigatorEvidenceManifest(),
      attestation: createChannelNavigatorReadinessAttestation()
    },
    playbooks: createChannelNavigatorPlaybooks(),
    decisions: createChannelNavigatorDecisionDeck(),
    escalationMoments: createChannelNavigatorEscalationMoments()
  };
}

export function createChannelNavigatorReadinessBoard(snapshot = buildChannelNavigatorSnapshot()) {
  return [
    { id: 'channel-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelNavigatorApiDocument(snapshot = buildChannelNavigatorSnapshot()) {
  return {
    id: 'channel-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-navigator/overview' },
      { method: 'GET', path: '/api/channel-navigator/reporting' },
      { method: 'POST', path: '/api/channel-navigator/validate' },
      { method: 'GET', path: '/api/channel-navigator/audit' }
    ],
    readiness: createChannelNavigatorReadinessBoard(snapshot)
  };
}

export function createChannelNavigatorRouteSummary(snapshot = buildChannelNavigatorSnapshot()) {
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

