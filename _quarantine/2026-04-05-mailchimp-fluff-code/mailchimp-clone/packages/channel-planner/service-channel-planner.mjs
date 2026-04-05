import { createChannelPlannerWorkspace, summarizeChannelPlannerWorkspace, createChannelPlannerNarratives, createChannelPlannerCoverageGrid } from './domain-channel-planner.mjs';
import { createChannelPlannerPolicies, validateChannelPlannerPolicies, summarizeChannelPlannerPolicies, createChannelPlannerEscalationDeck } from './policies-channel-planner.mjs';
import { createChannelPlannerAnalyticsTimeline, createChannelPlannerForecastEnvelope, createChannelPlannerExceptionLedger, summarizeChannelPlannerAnalytics } from './analytics-channel-planner.mjs';
import { createChannelPlannerOperationsBoard, createChannelPlannerShiftChecklist, createChannelPlannerIncidentDeck } from './operations-channel-planner.mjs';
import { createChannelPlannerReportCards, createChannelPlannerReviewPackets, summarizeChannelPlannerReporting } from './reporting-channel-planner.mjs';
import { createChannelPlannerAuditTrail, createChannelPlannerEvidenceManifest, createChannelPlannerReadinessAttestation } from './audit-channel-planner.mjs';
import { createChannelPlannerPlaybooks, createChannelPlannerDecisionDeck, createChannelPlannerEscalationMoments } from './playbooks-channel-planner.mjs';

export function buildChannelPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelPlannerWorkspace(workspaceName);
  const policies = createChannelPlannerPolicies();
  return {
    workspace,
    summary: summarizeChannelPlannerWorkspace(workspace),
    narratives: createChannelPlannerNarratives(workspace),
    coverage: createChannelPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelPlannerPolicies(policies),
    validation: validateChannelPlannerPolicies(policies),
    escalationDeck: createChannelPlannerEscalationDeck(policies),
    analytics: {
      timeline: createChannelPlannerAnalyticsTimeline(),
      forecast: createChannelPlannerForecastEnvelope(),
      exceptions: createChannelPlannerExceptionLedger(),
      summary: summarizeChannelPlannerAnalytics()
    },
    operations: {
      board: createChannelPlannerOperationsBoard(),
      checklist: createChannelPlannerShiftChecklist(),
      incidents: createChannelPlannerIncidentDeck()
    },
    reporting: {
      cards: createChannelPlannerReportCards(),
      packets: createChannelPlannerReviewPackets(),
      summary: summarizeChannelPlannerReporting()
    },
    audit: {
      trail: createChannelPlannerAuditTrail(),
      manifest: createChannelPlannerEvidenceManifest(),
      attestation: createChannelPlannerReadinessAttestation()
    },
    playbooks: createChannelPlannerPlaybooks(),
    decisions: createChannelPlannerDecisionDeck(),
    escalationMoments: createChannelPlannerEscalationMoments()
  };
}

export function createChannelPlannerReadinessBoard(snapshot = buildChannelPlannerSnapshot()) {
  return [
    { id: 'channel-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelPlannerApiDocument(snapshot = buildChannelPlannerSnapshot()) {
  return {
    id: 'channel-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-planner/overview' },
      { method: 'GET', path: '/api/channel-planner/reporting' },
      { method: 'POST', path: '/api/channel-planner/validate' },
      { method: 'GET', path: '/api/channel-planner/audit' }
    ],
    readiness: createChannelPlannerReadinessBoard(snapshot)
  };
}

export function createChannelPlannerRouteSummary(snapshot = buildChannelPlannerSnapshot()) {
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

