import { createLoyaltySentinelWorkspace, summarizeLoyaltySentinelWorkspace, createLoyaltySentinelNarratives, createLoyaltySentinelCoverageGrid } from './domain-loyalty-sentinel.mjs';
import { createLoyaltySentinelPolicies, validateLoyaltySentinelPolicies, summarizeLoyaltySentinelPolicies, createLoyaltySentinelEscalationDeck } from './policies-loyalty-sentinel.mjs';
import { createLoyaltySentinelAnalyticsTimeline, createLoyaltySentinelForecastEnvelope, createLoyaltySentinelExceptionLedger, summarizeLoyaltySentinelAnalytics } from './analytics-loyalty-sentinel.mjs';
import { createLoyaltySentinelOperationsBoard, createLoyaltySentinelShiftChecklist, createLoyaltySentinelIncidentDeck } from './operations-loyalty-sentinel.mjs';
import { createLoyaltySentinelReportCards, createLoyaltySentinelReviewPackets, summarizeLoyaltySentinelReporting } from './reporting-loyalty-sentinel.mjs';
import { createLoyaltySentinelAuditTrail, createLoyaltySentinelEvidenceManifest, createLoyaltySentinelReadinessAttestation } from './audit-loyalty-sentinel.mjs';
import { createLoyaltySentinelPlaybooks, createLoyaltySentinelDecisionDeck, createLoyaltySentinelEscalationMoments } from './playbooks-loyalty-sentinel.mjs';

export function buildLoyaltySentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltySentinelWorkspace(workspaceName);
  const policies = createLoyaltySentinelPolicies();
  return {
    workspace,
    summary: summarizeLoyaltySentinelWorkspace(workspace),
    narratives: createLoyaltySentinelNarratives(workspace),
    coverage: createLoyaltySentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltySentinelPolicies(policies),
    validation: validateLoyaltySentinelPolicies(policies),
    escalationDeck: createLoyaltySentinelEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltySentinelAnalyticsTimeline(),
      forecast: createLoyaltySentinelForecastEnvelope(),
      exceptions: createLoyaltySentinelExceptionLedger(),
      summary: summarizeLoyaltySentinelAnalytics()
    },
    operations: {
      board: createLoyaltySentinelOperationsBoard(),
      checklist: createLoyaltySentinelShiftChecklist(),
      incidents: createLoyaltySentinelIncidentDeck()
    },
    reporting: {
      cards: createLoyaltySentinelReportCards(),
      packets: createLoyaltySentinelReviewPackets(),
      summary: summarizeLoyaltySentinelReporting()
    },
    audit: {
      trail: createLoyaltySentinelAuditTrail(),
      manifest: createLoyaltySentinelEvidenceManifest(),
      attestation: createLoyaltySentinelReadinessAttestation()
    },
    playbooks: createLoyaltySentinelPlaybooks(),
    decisions: createLoyaltySentinelDecisionDeck(),
    escalationMoments: createLoyaltySentinelEscalationMoments()
  };
}

export function createLoyaltySentinelReadinessBoard(snapshot = buildLoyaltySentinelSnapshot()) {
  return [
    { id: 'loyalty-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltySentinelApiDocument(snapshot = buildLoyaltySentinelSnapshot()) {
  return {
    id: 'loyalty-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-sentinel/overview' },
      { method: 'GET', path: '/api/loyalty-sentinel/reporting' },
      { method: 'POST', path: '/api/loyalty-sentinel/validate' },
      { method: 'GET', path: '/api/loyalty-sentinel/audit' }
    ],
    readiness: createLoyaltySentinelReadinessBoard(snapshot)
  };
}

export function createLoyaltySentinelRouteSummary(snapshot = buildLoyaltySentinelSnapshot()) {
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

