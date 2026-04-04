import { createDataSentinelWorkspace, summarizeDataSentinelWorkspace, createDataSentinelNarratives, createDataSentinelCoverageGrid } from './domain-data-sentinel.mjs';
import { createDataSentinelPolicies, validateDataSentinelPolicies, summarizeDataSentinelPolicies, createDataSentinelEscalationDeck } from './policies-data-sentinel.mjs';
import { createDataSentinelAnalyticsTimeline, createDataSentinelForecastEnvelope, createDataSentinelExceptionLedger, summarizeDataSentinelAnalytics } from './analytics-data-sentinel.mjs';
import { createDataSentinelOperationsBoard, createDataSentinelShiftChecklist, createDataSentinelIncidentDeck } from './operations-data-sentinel.mjs';
import { createDataSentinelReportCards, createDataSentinelReviewPackets, summarizeDataSentinelReporting } from './reporting-data-sentinel.mjs';
import { createDataSentinelAuditTrail, createDataSentinelEvidenceManifest, createDataSentinelReadinessAttestation } from './audit-data-sentinel.mjs';
import { createDataSentinelPlaybooks, createDataSentinelDecisionDeck, createDataSentinelEscalationMoments } from './playbooks-data-sentinel.mjs';

export function buildDataSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataSentinelWorkspace(workspaceName);
  const policies = createDataSentinelPolicies();
  return {
    workspace,
    summary: summarizeDataSentinelWorkspace(workspace),
    narratives: createDataSentinelNarratives(workspace),
    coverage: createDataSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataSentinelPolicies(policies),
    validation: validateDataSentinelPolicies(policies),
    escalationDeck: createDataSentinelEscalationDeck(policies),
    analytics: {
      timeline: createDataSentinelAnalyticsTimeline(),
      forecast: createDataSentinelForecastEnvelope(),
      exceptions: createDataSentinelExceptionLedger(),
      summary: summarizeDataSentinelAnalytics()
    },
    operations: {
      board: createDataSentinelOperationsBoard(),
      checklist: createDataSentinelShiftChecklist(),
      incidents: createDataSentinelIncidentDeck()
    },
    reporting: {
      cards: createDataSentinelReportCards(),
      packets: createDataSentinelReviewPackets(),
      summary: summarizeDataSentinelReporting()
    },
    audit: {
      trail: createDataSentinelAuditTrail(),
      manifest: createDataSentinelEvidenceManifest(),
      attestation: createDataSentinelReadinessAttestation()
    },
    playbooks: createDataSentinelPlaybooks(),
    decisions: createDataSentinelDecisionDeck(),
    escalationMoments: createDataSentinelEscalationMoments()
  };
}

export function createDataSentinelReadinessBoard(snapshot = buildDataSentinelSnapshot()) {
  return [
    { id: 'data-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataSentinelApiDocument(snapshot = buildDataSentinelSnapshot()) {
  return {
    id: 'data-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-sentinel/overview' },
      { method: 'GET', path: '/api/data-sentinel/reporting' },
      { method: 'POST', path: '/api/data-sentinel/validate' },
      { method: 'GET', path: '/api/data-sentinel/audit' }
    ],
    readiness: createDataSentinelReadinessBoard(snapshot)
  };
}

export function createDataSentinelRouteSummary(snapshot = buildDataSentinelSnapshot()) {
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

