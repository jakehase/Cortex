import { createChannelFoundryWorkspace, summarizeChannelFoundryWorkspace, createChannelFoundryNarratives, createChannelFoundryCoverageGrid } from './domain-channel-foundry.mjs';
import { createChannelFoundryPolicies, validateChannelFoundryPolicies, summarizeChannelFoundryPolicies, createChannelFoundryEscalationDeck } from './policies-channel-foundry.mjs';
import { createChannelFoundryAnalyticsTimeline, createChannelFoundryForecastEnvelope, createChannelFoundryExceptionLedger, summarizeChannelFoundryAnalytics } from './analytics-channel-foundry.mjs';
import { createChannelFoundryOperationsBoard, createChannelFoundryShiftChecklist, createChannelFoundryIncidentDeck } from './operations-channel-foundry.mjs';
import { createChannelFoundryReportCards, createChannelFoundryReviewPackets, summarizeChannelFoundryReporting } from './reporting-channel-foundry.mjs';
import { createChannelFoundryAuditTrail, createChannelFoundryEvidenceManifest, createChannelFoundryReadinessAttestation } from './audit-channel-foundry.mjs';
import { createChannelFoundryPlaybooks, createChannelFoundryDecisionDeck, createChannelFoundryEscalationMoments } from './playbooks-channel-foundry.mjs';

export function buildChannelFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelFoundryWorkspace(workspaceName);
  const policies = createChannelFoundryPolicies();
  return {
    workspace,
    summary: summarizeChannelFoundryWorkspace(workspace),
    narratives: createChannelFoundryNarratives(workspace),
    coverage: createChannelFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelFoundryPolicies(policies),
    validation: validateChannelFoundryPolicies(policies),
    escalationDeck: createChannelFoundryEscalationDeck(policies),
    analytics: {
      timeline: createChannelFoundryAnalyticsTimeline(),
      forecast: createChannelFoundryForecastEnvelope(),
      exceptions: createChannelFoundryExceptionLedger(),
      summary: summarizeChannelFoundryAnalytics()
    },
    operations: {
      board: createChannelFoundryOperationsBoard(),
      checklist: createChannelFoundryShiftChecklist(),
      incidents: createChannelFoundryIncidentDeck()
    },
    reporting: {
      cards: createChannelFoundryReportCards(),
      packets: createChannelFoundryReviewPackets(),
      summary: summarizeChannelFoundryReporting()
    },
    audit: {
      trail: createChannelFoundryAuditTrail(),
      manifest: createChannelFoundryEvidenceManifest(),
      attestation: createChannelFoundryReadinessAttestation()
    },
    playbooks: createChannelFoundryPlaybooks(),
    decisions: createChannelFoundryDecisionDeck(),
    escalationMoments: createChannelFoundryEscalationMoments()
  };
}

export function createChannelFoundryReadinessBoard(snapshot = buildChannelFoundrySnapshot()) {
  return [
    { id: 'channel-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelFoundryApiDocument(snapshot = buildChannelFoundrySnapshot()) {
  return {
    id: 'channel-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-foundry/overview' },
      { method: 'GET', path: '/api/channel-foundry/reporting' },
      { method: 'POST', path: '/api/channel-foundry/validate' },
      { method: 'GET', path: '/api/channel-foundry/audit' }
    ],
    readiness: createChannelFoundryReadinessBoard(snapshot)
  };
}

export function createChannelFoundryRouteSummary(snapshot = buildChannelFoundrySnapshot()) {
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

