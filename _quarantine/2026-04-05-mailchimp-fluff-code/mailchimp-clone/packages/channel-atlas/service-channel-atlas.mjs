import { createChannelAtlasWorkspace, summarizeChannelAtlasWorkspace, createChannelAtlasNarratives, createChannelAtlasCoverageGrid } from './domain-channel-atlas.mjs';
import { createChannelAtlasPolicies, validateChannelAtlasPolicies, summarizeChannelAtlasPolicies, createChannelAtlasEscalationDeck } from './policies-channel-atlas.mjs';
import { createChannelAtlasAnalyticsTimeline, createChannelAtlasForecastEnvelope, createChannelAtlasExceptionLedger, summarizeChannelAtlasAnalytics } from './analytics-channel-atlas.mjs';
import { createChannelAtlasOperationsBoard, createChannelAtlasShiftChecklist, createChannelAtlasIncidentDeck } from './operations-channel-atlas.mjs';
import { createChannelAtlasReportCards, createChannelAtlasReviewPackets, summarizeChannelAtlasReporting } from './reporting-channel-atlas.mjs';
import { createChannelAtlasAuditTrail, createChannelAtlasEvidenceManifest, createChannelAtlasReadinessAttestation } from './audit-channel-atlas.mjs';
import { createChannelAtlasPlaybooks, createChannelAtlasDecisionDeck, createChannelAtlasEscalationMoments } from './playbooks-channel-atlas.mjs';

export function buildChannelAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelAtlasWorkspace(workspaceName);
  const policies = createChannelAtlasPolicies();
  return {
    workspace,
    summary: summarizeChannelAtlasWorkspace(workspace),
    narratives: createChannelAtlasNarratives(workspace),
    coverage: createChannelAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelAtlasPolicies(policies),
    validation: validateChannelAtlasPolicies(policies),
    escalationDeck: createChannelAtlasEscalationDeck(policies),
    analytics: {
      timeline: createChannelAtlasAnalyticsTimeline(),
      forecast: createChannelAtlasForecastEnvelope(),
      exceptions: createChannelAtlasExceptionLedger(),
      summary: summarizeChannelAtlasAnalytics()
    },
    operations: {
      board: createChannelAtlasOperationsBoard(),
      checklist: createChannelAtlasShiftChecklist(),
      incidents: createChannelAtlasIncidentDeck()
    },
    reporting: {
      cards: createChannelAtlasReportCards(),
      packets: createChannelAtlasReviewPackets(),
      summary: summarizeChannelAtlasReporting()
    },
    audit: {
      trail: createChannelAtlasAuditTrail(),
      manifest: createChannelAtlasEvidenceManifest(),
      attestation: createChannelAtlasReadinessAttestation()
    },
    playbooks: createChannelAtlasPlaybooks(),
    decisions: createChannelAtlasDecisionDeck(),
    escalationMoments: createChannelAtlasEscalationMoments()
  };
}

export function createChannelAtlasReadinessBoard(snapshot = buildChannelAtlasSnapshot()) {
  return [
    { id: 'channel-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelAtlasApiDocument(snapshot = buildChannelAtlasSnapshot()) {
  return {
    id: 'channel-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-atlas/overview' },
      { method: 'GET', path: '/api/channel-atlas/reporting' },
      { method: 'POST', path: '/api/channel-atlas/validate' },
      { method: 'GET', path: '/api/channel-atlas/audit' }
    ],
    readiness: createChannelAtlasReadinessBoard(snapshot)
  };
}

export function createChannelAtlasRouteSummary(snapshot = buildChannelAtlasSnapshot()) {
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

