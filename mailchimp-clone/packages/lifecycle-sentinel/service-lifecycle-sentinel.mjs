import { createLifecycleSentinelWorkspace, summarizeLifecycleSentinelWorkspace, createLifecycleSentinelNarratives, createLifecycleSentinelCoverageGrid } from './domain-lifecycle-sentinel.mjs';
import { createLifecycleSentinelPolicies, validateLifecycleSentinelPolicies, summarizeLifecycleSentinelPolicies, createLifecycleSentinelEscalationDeck } from './policies-lifecycle-sentinel.mjs';
import { createLifecycleSentinelAnalyticsTimeline, createLifecycleSentinelForecastEnvelope, createLifecycleSentinelExceptionLedger, summarizeLifecycleSentinelAnalytics } from './analytics-lifecycle-sentinel.mjs';
import { createLifecycleSentinelOperationsBoard, createLifecycleSentinelShiftChecklist, createLifecycleSentinelIncidentDeck } from './operations-lifecycle-sentinel.mjs';
import { createLifecycleSentinelReportCards, createLifecycleSentinelReviewPackets, summarizeLifecycleSentinelReporting } from './reporting-lifecycle-sentinel.mjs';
import { createLifecycleSentinelAuditTrail, createLifecycleSentinelEvidenceManifest, createLifecycleSentinelReadinessAttestation } from './audit-lifecycle-sentinel.mjs';
import { createLifecycleSentinelPlaybooks, createLifecycleSentinelDecisionDeck, createLifecycleSentinelEscalationMoments } from './playbooks-lifecycle-sentinel.mjs';

export function buildLifecycleSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleSentinelWorkspace(workspaceName);
  const policies = createLifecycleSentinelPolicies();
  return {
    workspace,
    summary: summarizeLifecycleSentinelWorkspace(workspace),
    narratives: createLifecycleSentinelNarratives(workspace),
    coverage: createLifecycleSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleSentinelPolicies(policies),
    validation: validateLifecycleSentinelPolicies(policies),
    escalationDeck: createLifecycleSentinelEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleSentinelAnalyticsTimeline(),
      forecast: createLifecycleSentinelForecastEnvelope(),
      exceptions: createLifecycleSentinelExceptionLedger(),
      summary: summarizeLifecycleSentinelAnalytics()
    },
    operations: {
      board: createLifecycleSentinelOperationsBoard(),
      checklist: createLifecycleSentinelShiftChecklist(),
      incidents: createLifecycleSentinelIncidentDeck()
    },
    reporting: {
      cards: createLifecycleSentinelReportCards(),
      packets: createLifecycleSentinelReviewPackets(),
      summary: summarizeLifecycleSentinelReporting()
    },
    audit: {
      trail: createLifecycleSentinelAuditTrail(),
      manifest: createLifecycleSentinelEvidenceManifest(),
      attestation: createLifecycleSentinelReadinessAttestation()
    },
    playbooks: createLifecycleSentinelPlaybooks(),
    decisions: createLifecycleSentinelDecisionDeck(),
    escalationMoments: createLifecycleSentinelEscalationMoments()
  };
}

export function createLifecycleSentinelReadinessBoard(snapshot = buildLifecycleSentinelSnapshot()) {
  return [
    { id: 'lifecycle-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleSentinelApiDocument(snapshot = buildLifecycleSentinelSnapshot()) {
  return {
    id: 'lifecycle-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-sentinel/overview' },
      { method: 'GET', path: '/api/lifecycle-sentinel/reporting' },
      { method: 'POST', path: '/api/lifecycle-sentinel/validate' },
      { method: 'GET', path: '/api/lifecycle-sentinel/audit' }
    ],
    readiness: createLifecycleSentinelReadinessBoard(snapshot)
  };
}

export function createLifecycleSentinelRouteSummary(snapshot = buildLifecycleSentinelSnapshot()) {
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

