import { createInsightsHubWorkspace, summarizeInsightsHubWorkspace, createInsightsHubNarratives, createInsightsHubCoverageGrid } from './domain-insights-hub.mjs';
import { createInsightsHubPolicies, validateInsightsHubPolicies, summarizeInsightsHubPolicies, createInsightsHubEscalationDeck } from './policies-insights-hub.mjs';
import { createInsightsHubAnalyticsTimeline, createInsightsHubForecastEnvelope, createInsightsHubExceptionLedger, summarizeInsightsHubAnalytics } from './analytics-insights-hub.mjs';
import { createInsightsHubOperationsBoard, createInsightsHubShiftChecklist, createInsightsHubIncidentDeck } from './operations-insights-hub.mjs';
import { createInsightsHubReportCards, createInsightsHubReviewPackets, summarizeInsightsHubReporting } from './reporting-insights-hub.mjs';
import { createInsightsHubAuditTrail, createInsightsHubEvidenceManifest, createInsightsHubReadinessAttestation } from './audit-insights-hub.mjs';
import { createInsightsHubPlaybooks, createInsightsHubDecisionDeck, createInsightsHubEscalationMoments } from './playbooks-insights-hub.mjs';

export function buildInsightsHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsHubWorkspace(workspaceName);
  const policies = createInsightsHubPolicies();
  return {
    workspace,
    summary: summarizeInsightsHubWorkspace(workspace),
    narratives: createInsightsHubNarratives(workspace),
    coverage: createInsightsHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsHubPolicies(policies),
    validation: validateInsightsHubPolicies(policies),
    escalationDeck: createInsightsHubEscalationDeck(policies),
    analytics: {
      timeline: createInsightsHubAnalyticsTimeline(),
      forecast: createInsightsHubForecastEnvelope(),
      exceptions: createInsightsHubExceptionLedger(),
      summary: summarizeInsightsHubAnalytics()
    },
    operations: {
      board: createInsightsHubOperationsBoard(),
      checklist: createInsightsHubShiftChecklist(),
      incidents: createInsightsHubIncidentDeck()
    },
    reporting: {
      cards: createInsightsHubReportCards(),
      packets: createInsightsHubReviewPackets(),
      summary: summarizeInsightsHubReporting()
    },
    audit: {
      trail: createInsightsHubAuditTrail(),
      manifest: createInsightsHubEvidenceManifest(),
      attestation: createInsightsHubReadinessAttestation()
    },
    playbooks: createInsightsHubPlaybooks(),
    decisions: createInsightsHubDecisionDeck(),
    escalationMoments: createInsightsHubEscalationMoments()
  };
}

export function createInsightsHubReadinessBoard(snapshot = buildInsightsHubSnapshot()) {
  return [
    { id: 'insights-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsHubApiDocument(snapshot = buildInsightsHubSnapshot()) {
  return {
    id: 'insights-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-hub/overview' },
      { method: 'GET', path: '/api/insights-hub/reporting' },
      { method: 'POST', path: '/api/insights-hub/validate' },
      { method: 'GET', path: '/api/insights-hub/audit' }
    ],
    readiness: createInsightsHubReadinessBoard(snapshot)
  };
}

export function createInsightsHubRouteSummary(snapshot = buildInsightsHubSnapshot()) {
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

