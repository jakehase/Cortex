import { createContentSentinelWorkspace, summarizeContentSentinelWorkspace, createContentSentinelNarratives, createContentSentinelCoverageGrid } from './domain-content-sentinel.mjs';
import { createContentSentinelPolicies, validateContentSentinelPolicies, summarizeContentSentinelPolicies, createContentSentinelEscalationDeck } from './policies-content-sentinel.mjs';
import { createContentSentinelAnalyticsTimeline, createContentSentinelForecastEnvelope, createContentSentinelExceptionLedger, summarizeContentSentinelAnalytics } from './analytics-content-sentinel.mjs';
import { createContentSentinelOperationsBoard, createContentSentinelShiftChecklist, createContentSentinelIncidentDeck } from './operations-content-sentinel.mjs';
import { createContentSentinelReportCards, createContentSentinelReviewPackets, summarizeContentSentinelReporting } from './reporting-content-sentinel.mjs';
import { createContentSentinelAuditTrail, createContentSentinelEvidenceManifest, createContentSentinelReadinessAttestation } from './audit-content-sentinel.mjs';
import { createContentSentinelPlaybooks, createContentSentinelDecisionDeck, createContentSentinelEscalationMoments } from './playbooks-content-sentinel.mjs';

export function buildContentSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentSentinelWorkspace(workspaceName);
  const policies = createContentSentinelPolicies();
  return {
    workspace,
    summary: summarizeContentSentinelWorkspace(workspace),
    narratives: createContentSentinelNarratives(workspace),
    coverage: createContentSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentSentinelPolicies(policies),
    validation: validateContentSentinelPolicies(policies),
    escalationDeck: createContentSentinelEscalationDeck(policies),
    analytics: {
      timeline: createContentSentinelAnalyticsTimeline(),
      forecast: createContentSentinelForecastEnvelope(),
      exceptions: createContentSentinelExceptionLedger(),
      summary: summarizeContentSentinelAnalytics()
    },
    operations: {
      board: createContentSentinelOperationsBoard(),
      checklist: createContentSentinelShiftChecklist(),
      incidents: createContentSentinelIncidentDeck()
    },
    reporting: {
      cards: createContentSentinelReportCards(),
      packets: createContentSentinelReviewPackets(),
      summary: summarizeContentSentinelReporting()
    },
    audit: {
      trail: createContentSentinelAuditTrail(),
      manifest: createContentSentinelEvidenceManifest(),
      attestation: createContentSentinelReadinessAttestation()
    },
    playbooks: createContentSentinelPlaybooks(),
    decisions: createContentSentinelDecisionDeck(),
    escalationMoments: createContentSentinelEscalationMoments()
  };
}

export function createContentSentinelReadinessBoard(snapshot = buildContentSentinelSnapshot()) {
  return [
    { id: 'content-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentSentinelApiDocument(snapshot = buildContentSentinelSnapshot()) {
  return {
    id: 'content-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-sentinel/overview' },
      { method: 'GET', path: '/api/content-sentinel/reporting' },
      { method: 'POST', path: '/api/content-sentinel/validate' },
      { method: 'GET', path: '/api/content-sentinel/audit' }
    ],
    readiness: createContentSentinelReadinessBoard(snapshot)
  };
}

export function createContentSentinelRouteSummary(snapshot = buildContentSentinelSnapshot()) {
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

