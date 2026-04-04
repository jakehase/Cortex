import { createCommerceSentinelWorkspace, summarizeCommerceSentinelWorkspace, createCommerceSentinelNarratives, createCommerceSentinelCoverageGrid } from './domain-commerce-sentinel.mjs';
import { createCommerceSentinelPolicies, validateCommerceSentinelPolicies, summarizeCommerceSentinelPolicies, createCommerceSentinelEscalationDeck } from './policies-commerce-sentinel.mjs';
import { createCommerceSentinelAnalyticsTimeline, createCommerceSentinelForecastEnvelope, createCommerceSentinelExceptionLedger, summarizeCommerceSentinelAnalytics } from './analytics-commerce-sentinel.mjs';
import { createCommerceSentinelOperationsBoard, createCommerceSentinelShiftChecklist, createCommerceSentinelIncidentDeck } from './operations-commerce-sentinel.mjs';
import { createCommerceSentinelReportCards, createCommerceSentinelReviewPackets, summarizeCommerceSentinelReporting } from './reporting-commerce-sentinel.mjs';
import { createCommerceSentinelAuditTrail, createCommerceSentinelEvidenceManifest, createCommerceSentinelReadinessAttestation } from './audit-commerce-sentinel.mjs';
import { createCommerceSentinelPlaybooks, createCommerceSentinelDecisionDeck, createCommerceSentinelEscalationMoments } from './playbooks-commerce-sentinel.mjs';

export function buildCommerceSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceSentinelWorkspace(workspaceName);
  const policies = createCommerceSentinelPolicies();
  return {
    workspace,
    summary: summarizeCommerceSentinelWorkspace(workspace),
    narratives: createCommerceSentinelNarratives(workspace),
    coverage: createCommerceSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceSentinelPolicies(policies),
    validation: validateCommerceSentinelPolicies(policies),
    escalationDeck: createCommerceSentinelEscalationDeck(policies),
    analytics: {
      timeline: createCommerceSentinelAnalyticsTimeline(),
      forecast: createCommerceSentinelForecastEnvelope(),
      exceptions: createCommerceSentinelExceptionLedger(),
      summary: summarizeCommerceSentinelAnalytics()
    },
    operations: {
      board: createCommerceSentinelOperationsBoard(),
      checklist: createCommerceSentinelShiftChecklist(),
      incidents: createCommerceSentinelIncidentDeck()
    },
    reporting: {
      cards: createCommerceSentinelReportCards(),
      packets: createCommerceSentinelReviewPackets(),
      summary: summarizeCommerceSentinelReporting()
    },
    audit: {
      trail: createCommerceSentinelAuditTrail(),
      manifest: createCommerceSentinelEvidenceManifest(),
      attestation: createCommerceSentinelReadinessAttestation()
    },
    playbooks: createCommerceSentinelPlaybooks(),
    decisions: createCommerceSentinelDecisionDeck(),
    escalationMoments: createCommerceSentinelEscalationMoments()
  };
}

export function createCommerceSentinelReadinessBoard(snapshot = buildCommerceSentinelSnapshot()) {
  return [
    { id: 'commerce-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceSentinelApiDocument(snapshot = buildCommerceSentinelSnapshot()) {
  return {
    id: 'commerce-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-sentinel/overview' },
      { method: 'GET', path: '/api/commerce-sentinel/reporting' },
      { method: 'POST', path: '/api/commerce-sentinel/validate' },
      { method: 'GET', path: '/api/commerce-sentinel/audit' }
    ],
    readiness: createCommerceSentinelReadinessBoard(snapshot)
  };
}

export function createCommerceSentinelRouteSummary(snapshot = buildCommerceSentinelSnapshot()) {
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

