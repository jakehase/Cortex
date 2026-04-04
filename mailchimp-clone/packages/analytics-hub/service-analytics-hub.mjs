import { createAnalyticsHubWorkspace, summarizeAnalyticsHubWorkspace, createAnalyticsHubNarratives, createAnalyticsHubCoverageGrid } from './domain-analytics-hub.mjs';
import { createAnalyticsHubPolicies, validateAnalyticsHubPolicies, summarizeAnalyticsHubPolicies, createAnalyticsHubEscalationDeck } from './policies-analytics-hub.mjs';
import { createAnalyticsHubAnalyticsTimeline, createAnalyticsHubForecastEnvelope, createAnalyticsHubExceptionLedger, summarizeAnalyticsHubAnalytics } from './analytics-analytics-hub.mjs';
import { createAnalyticsHubOperationsBoard, createAnalyticsHubShiftChecklist, createAnalyticsHubIncidentDeck } from './operations-analytics-hub.mjs';
import { createAnalyticsHubReportCards, createAnalyticsHubReviewPackets, summarizeAnalyticsHubReporting } from './reporting-analytics-hub.mjs';
import { createAnalyticsHubAuditTrail, createAnalyticsHubEvidenceManifest, createAnalyticsHubReadinessAttestation } from './audit-analytics-hub.mjs';
import { createAnalyticsHubPlaybooks, createAnalyticsHubDecisionDeck, createAnalyticsHubEscalationMoments } from './playbooks-analytics-hub.mjs';

export function buildAnalyticsHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsHubWorkspace(workspaceName);
  const policies = createAnalyticsHubPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsHubWorkspace(workspace),
    narratives: createAnalyticsHubNarratives(workspace),
    coverage: createAnalyticsHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsHubPolicies(policies),
    validation: validateAnalyticsHubPolicies(policies),
    escalationDeck: createAnalyticsHubEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsHubAnalyticsTimeline(),
      forecast: createAnalyticsHubForecastEnvelope(),
      exceptions: createAnalyticsHubExceptionLedger(),
      summary: summarizeAnalyticsHubAnalytics()
    },
    operations: {
      board: createAnalyticsHubOperationsBoard(),
      checklist: createAnalyticsHubShiftChecklist(),
      incidents: createAnalyticsHubIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsHubReportCards(),
      packets: createAnalyticsHubReviewPackets(),
      summary: summarizeAnalyticsHubReporting()
    },
    audit: {
      trail: createAnalyticsHubAuditTrail(),
      manifest: createAnalyticsHubEvidenceManifest(),
      attestation: createAnalyticsHubReadinessAttestation()
    },
    playbooks: createAnalyticsHubPlaybooks(),
    decisions: createAnalyticsHubDecisionDeck(),
    escalationMoments: createAnalyticsHubEscalationMoments()
  };
}

export function createAnalyticsHubReadinessBoard(snapshot = buildAnalyticsHubSnapshot()) {
  return [
    { id: 'analytics-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsHubApiDocument(snapshot = buildAnalyticsHubSnapshot()) {
  return {
    id: 'analytics-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-hub/overview' },
      { method: 'GET', path: '/api/analytics-hub/reporting' },
      { method: 'POST', path: '/api/analytics-hub/validate' },
      { method: 'GET', path: '/api/analytics-hub/audit' }
    ],
    readiness: createAnalyticsHubReadinessBoard(snapshot)
  };
}

export function createAnalyticsHubRouteSummary(snapshot = buildAnalyticsHubSnapshot()) {
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

