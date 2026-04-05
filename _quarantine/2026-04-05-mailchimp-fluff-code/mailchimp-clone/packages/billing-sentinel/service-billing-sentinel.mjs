import { createBillingSentinelWorkspace, summarizeBillingSentinelWorkspace, createBillingSentinelNarratives, createBillingSentinelCoverageGrid } from './domain-billing-sentinel.mjs';
import { createBillingSentinelPolicies, validateBillingSentinelPolicies, summarizeBillingSentinelPolicies, createBillingSentinelEscalationDeck } from './policies-billing-sentinel.mjs';
import { createBillingSentinelAnalyticsTimeline, createBillingSentinelForecastEnvelope, createBillingSentinelExceptionLedger, summarizeBillingSentinelAnalytics } from './analytics-billing-sentinel.mjs';
import { createBillingSentinelOperationsBoard, createBillingSentinelShiftChecklist, createBillingSentinelIncidentDeck } from './operations-billing-sentinel.mjs';
import { createBillingSentinelReportCards, createBillingSentinelReviewPackets, summarizeBillingSentinelReporting } from './reporting-billing-sentinel.mjs';
import { createBillingSentinelAuditTrail, createBillingSentinelEvidenceManifest, createBillingSentinelReadinessAttestation } from './audit-billing-sentinel.mjs';
import { createBillingSentinelPlaybooks, createBillingSentinelDecisionDeck, createBillingSentinelEscalationMoments } from './playbooks-billing-sentinel.mjs';

export function buildBillingSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingSentinelWorkspace(workspaceName);
  const policies = createBillingSentinelPolicies();
  return {
    workspace,
    summary: summarizeBillingSentinelWorkspace(workspace),
    narratives: createBillingSentinelNarratives(workspace),
    coverage: createBillingSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingSentinelPolicies(policies),
    validation: validateBillingSentinelPolicies(policies),
    escalationDeck: createBillingSentinelEscalationDeck(policies),
    analytics: {
      timeline: createBillingSentinelAnalyticsTimeline(),
      forecast: createBillingSentinelForecastEnvelope(),
      exceptions: createBillingSentinelExceptionLedger(),
      summary: summarizeBillingSentinelAnalytics()
    },
    operations: {
      board: createBillingSentinelOperationsBoard(),
      checklist: createBillingSentinelShiftChecklist(),
      incidents: createBillingSentinelIncidentDeck()
    },
    reporting: {
      cards: createBillingSentinelReportCards(),
      packets: createBillingSentinelReviewPackets(),
      summary: summarizeBillingSentinelReporting()
    },
    audit: {
      trail: createBillingSentinelAuditTrail(),
      manifest: createBillingSentinelEvidenceManifest(),
      attestation: createBillingSentinelReadinessAttestation()
    },
    playbooks: createBillingSentinelPlaybooks(),
    decisions: createBillingSentinelDecisionDeck(),
    escalationMoments: createBillingSentinelEscalationMoments()
  };
}

export function createBillingSentinelReadinessBoard(snapshot = buildBillingSentinelSnapshot()) {
  return [
    { id: 'billing-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingSentinelApiDocument(snapshot = buildBillingSentinelSnapshot()) {
  return {
    id: 'billing-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-sentinel/overview' },
      { method: 'GET', path: '/api/billing-sentinel/reporting' },
      { method: 'POST', path: '/api/billing-sentinel/validate' },
      { method: 'GET', path: '/api/billing-sentinel/audit' }
    ],
    readiness: createBillingSentinelReadinessBoard(snapshot)
  };
}

export function createBillingSentinelRouteSummary(snapshot = buildBillingSentinelSnapshot()) {
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

