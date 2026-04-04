import { createInsightsSentinelWorkspace, summarizeInsightsSentinelWorkspace, createInsightsSentinelNarratives, createInsightsSentinelCoverageGrid } from './domain-insights-sentinel.mjs';
import { createInsightsSentinelPolicies, validateInsightsSentinelPolicies, summarizeInsightsSentinelPolicies, createInsightsSentinelEscalationDeck } from './policies-insights-sentinel.mjs';
import { createInsightsSentinelAnalyticsTimeline, createInsightsSentinelForecastEnvelope, createInsightsSentinelExceptionLedger, summarizeInsightsSentinelAnalytics } from './analytics-insights-sentinel.mjs';
import { createInsightsSentinelOperationsBoard, createInsightsSentinelShiftChecklist, createInsightsSentinelIncidentDeck } from './operations-insights-sentinel.mjs';
import { createInsightsSentinelReportCards, createInsightsSentinelReviewPackets, summarizeInsightsSentinelReporting } from './reporting-insights-sentinel.mjs';
import { createInsightsSentinelAuditTrail, createInsightsSentinelEvidenceManifest, createInsightsSentinelReadinessAttestation } from './audit-insights-sentinel.mjs';
import { createInsightsSentinelPlaybooks, createInsightsSentinelDecisionDeck, createInsightsSentinelEscalationMoments } from './playbooks-insights-sentinel.mjs';

export function buildInsightsSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsSentinelWorkspace(workspaceName);
  const policies = createInsightsSentinelPolicies();
  return {
    workspace,
    summary: summarizeInsightsSentinelWorkspace(workspace),
    narratives: createInsightsSentinelNarratives(workspace),
    coverage: createInsightsSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsSentinelPolicies(policies),
    validation: validateInsightsSentinelPolicies(policies),
    escalationDeck: createInsightsSentinelEscalationDeck(policies),
    analytics: {
      timeline: createInsightsSentinelAnalyticsTimeline(),
      forecast: createInsightsSentinelForecastEnvelope(),
      exceptions: createInsightsSentinelExceptionLedger(),
      summary: summarizeInsightsSentinelAnalytics()
    },
    operations: {
      board: createInsightsSentinelOperationsBoard(),
      checklist: createInsightsSentinelShiftChecklist(),
      incidents: createInsightsSentinelIncidentDeck()
    },
    reporting: {
      cards: createInsightsSentinelReportCards(),
      packets: createInsightsSentinelReviewPackets(),
      summary: summarizeInsightsSentinelReporting()
    },
    audit: {
      trail: createInsightsSentinelAuditTrail(),
      manifest: createInsightsSentinelEvidenceManifest(),
      attestation: createInsightsSentinelReadinessAttestation()
    },
    playbooks: createInsightsSentinelPlaybooks(),
    decisions: createInsightsSentinelDecisionDeck(),
    escalationMoments: createInsightsSentinelEscalationMoments()
  };
}

export function createInsightsSentinelReadinessBoard(snapshot = buildInsightsSentinelSnapshot()) {
  return [
    { id: 'insights-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsSentinelApiDocument(snapshot = buildInsightsSentinelSnapshot()) {
  return {
    id: 'insights-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-sentinel/overview' },
      { method: 'GET', path: '/api/insights-sentinel/reporting' },
      { method: 'POST', path: '/api/insights-sentinel/validate' },
      { method: 'GET', path: '/api/insights-sentinel/audit' }
    ],
    readiness: createInsightsSentinelReadinessBoard(snapshot)
  };
}

export function createInsightsSentinelRouteSummary(snapshot = buildInsightsSentinelSnapshot()) {
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

