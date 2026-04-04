import { createChannelAdvisorWorkspace, summarizeChannelAdvisorWorkspace, createChannelAdvisorNarratives, createChannelAdvisorCoverageGrid } from './domain-channel-advisor.mjs';
import { createChannelAdvisorPolicies, validateChannelAdvisorPolicies, summarizeChannelAdvisorPolicies, createChannelAdvisorEscalationDeck } from './policies-channel-advisor.mjs';
import { createChannelAdvisorAnalyticsTimeline, createChannelAdvisorForecastEnvelope, createChannelAdvisorExceptionLedger, summarizeChannelAdvisorAnalytics } from './analytics-channel-advisor.mjs';
import { createChannelAdvisorOperationsBoard, createChannelAdvisorShiftChecklist, createChannelAdvisorIncidentDeck } from './operations-channel-advisor.mjs';
import { createChannelAdvisorReportCards, createChannelAdvisorReviewPackets, summarizeChannelAdvisorReporting } from './reporting-channel-advisor.mjs';
import { createChannelAdvisorAuditTrail, createChannelAdvisorEvidenceManifest, createChannelAdvisorReadinessAttestation } from './audit-channel-advisor.mjs';
import { createChannelAdvisorPlaybooks, createChannelAdvisorDecisionDeck, createChannelAdvisorEscalationMoments } from './playbooks-channel-advisor.mjs';

export function buildChannelAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelAdvisorWorkspace(workspaceName);
  const policies = createChannelAdvisorPolicies();
  return {
    workspace,
    summary: summarizeChannelAdvisorWorkspace(workspace),
    narratives: createChannelAdvisorNarratives(workspace),
    coverage: createChannelAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelAdvisorPolicies(policies),
    validation: validateChannelAdvisorPolicies(policies),
    escalationDeck: createChannelAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createChannelAdvisorAnalyticsTimeline(),
      forecast: createChannelAdvisorForecastEnvelope(),
      exceptions: createChannelAdvisorExceptionLedger(),
      summary: summarizeChannelAdvisorAnalytics()
    },
    operations: {
      board: createChannelAdvisorOperationsBoard(),
      checklist: createChannelAdvisorShiftChecklist(),
      incidents: createChannelAdvisorIncidentDeck()
    },
    reporting: {
      cards: createChannelAdvisorReportCards(),
      packets: createChannelAdvisorReviewPackets(),
      summary: summarizeChannelAdvisorReporting()
    },
    audit: {
      trail: createChannelAdvisorAuditTrail(),
      manifest: createChannelAdvisorEvidenceManifest(),
      attestation: createChannelAdvisorReadinessAttestation()
    },
    playbooks: createChannelAdvisorPlaybooks(),
    decisions: createChannelAdvisorDecisionDeck(),
    escalationMoments: createChannelAdvisorEscalationMoments()
  };
}

export function createChannelAdvisorReadinessBoard(snapshot = buildChannelAdvisorSnapshot()) {
  return [
    { id: 'channel-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelAdvisorApiDocument(snapshot = buildChannelAdvisorSnapshot()) {
  return {
    id: 'channel-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-advisor/overview' },
      { method: 'GET', path: '/api/channel-advisor/reporting' },
      { method: 'POST', path: '/api/channel-advisor/validate' },
      { method: 'GET', path: '/api/channel-advisor/audit' }
    ],
    readiness: createChannelAdvisorReadinessBoard(snapshot)
  };
}

export function createChannelAdvisorRouteSummary(snapshot = buildChannelAdvisorSnapshot()) {
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

