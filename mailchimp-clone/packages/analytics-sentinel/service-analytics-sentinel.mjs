import { createAnalyticsSentinelWorkspace, summarizeAnalyticsSentinelWorkspace, createAnalyticsSentinelNarratives, createAnalyticsSentinelCoverageGrid } from './domain-analytics-sentinel.mjs';
import { createAnalyticsSentinelPolicies, validateAnalyticsSentinelPolicies, summarizeAnalyticsSentinelPolicies, createAnalyticsSentinelEscalationDeck } from './policies-analytics-sentinel.mjs';
import { createAnalyticsSentinelAnalyticsTimeline, createAnalyticsSentinelForecastEnvelope, createAnalyticsSentinelExceptionLedger, summarizeAnalyticsSentinelAnalytics } from './analytics-analytics-sentinel.mjs';
import { createAnalyticsSentinelOperationsBoard, createAnalyticsSentinelShiftChecklist, createAnalyticsSentinelIncidentDeck } from './operations-analytics-sentinel.mjs';
import { createAnalyticsSentinelReportCards, createAnalyticsSentinelReviewPackets, summarizeAnalyticsSentinelReporting } from './reporting-analytics-sentinel.mjs';
import { createAnalyticsSentinelAuditTrail, createAnalyticsSentinelEvidenceManifest, createAnalyticsSentinelReadinessAttestation } from './audit-analytics-sentinel.mjs';
import { createAnalyticsSentinelPlaybooks, createAnalyticsSentinelDecisionDeck, createAnalyticsSentinelEscalationMoments } from './playbooks-analytics-sentinel.mjs';

export function buildAnalyticsSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsSentinelWorkspace(workspaceName);
  const policies = createAnalyticsSentinelPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsSentinelWorkspace(workspace),
    narratives: createAnalyticsSentinelNarratives(workspace),
    coverage: createAnalyticsSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsSentinelPolicies(policies),
    validation: validateAnalyticsSentinelPolicies(policies),
    escalationDeck: createAnalyticsSentinelEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsSentinelAnalyticsTimeline(),
      forecast: createAnalyticsSentinelForecastEnvelope(),
      exceptions: createAnalyticsSentinelExceptionLedger(),
      summary: summarizeAnalyticsSentinelAnalytics()
    },
    operations: {
      board: createAnalyticsSentinelOperationsBoard(),
      checklist: createAnalyticsSentinelShiftChecklist(),
      incidents: createAnalyticsSentinelIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsSentinelReportCards(),
      packets: createAnalyticsSentinelReviewPackets(),
      summary: summarizeAnalyticsSentinelReporting()
    },
    audit: {
      trail: createAnalyticsSentinelAuditTrail(),
      manifest: createAnalyticsSentinelEvidenceManifest(),
      attestation: createAnalyticsSentinelReadinessAttestation()
    },
    playbooks: createAnalyticsSentinelPlaybooks(),
    decisions: createAnalyticsSentinelDecisionDeck(),
    escalationMoments: createAnalyticsSentinelEscalationMoments()
  };
}

export function createAnalyticsSentinelReadinessBoard(snapshot = buildAnalyticsSentinelSnapshot()) {
  return [
    { id: 'analytics-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsSentinelApiDocument(snapshot = buildAnalyticsSentinelSnapshot()) {
  return {
    id: 'analytics-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-sentinel/overview' },
      { method: 'GET', path: '/api/analytics-sentinel/reporting' },
      { method: 'POST', path: '/api/analytics-sentinel/validate' },
      { method: 'GET', path: '/api/analytics-sentinel/audit' }
    ],
    readiness: createAnalyticsSentinelReadinessBoard(snapshot)
  };
}

export function createAnalyticsSentinelRouteSummary(snapshot = buildAnalyticsSentinelSnapshot()) {
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

