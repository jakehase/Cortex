import { createAttributionSentinelWorkspace, summarizeAttributionSentinelWorkspace, createAttributionSentinelNarratives, createAttributionSentinelCoverageGrid } from './domain-attribution-sentinel.mjs';
import { createAttributionSentinelPolicies, validateAttributionSentinelPolicies, summarizeAttributionSentinelPolicies, createAttributionSentinelEscalationDeck } from './policies-attribution-sentinel.mjs';
import { createAttributionSentinelAnalyticsTimeline, createAttributionSentinelForecastEnvelope, createAttributionSentinelExceptionLedger, summarizeAttributionSentinelAnalytics } from './analytics-attribution-sentinel.mjs';
import { createAttributionSentinelOperationsBoard, createAttributionSentinelShiftChecklist, createAttributionSentinelIncidentDeck } from './operations-attribution-sentinel.mjs';
import { createAttributionSentinelReportCards, createAttributionSentinelReviewPackets, summarizeAttributionSentinelReporting } from './reporting-attribution-sentinel.mjs';
import { createAttributionSentinelAuditTrail, createAttributionSentinelEvidenceManifest, createAttributionSentinelReadinessAttestation } from './audit-attribution-sentinel.mjs';
import { createAttributionSentinelPlaybooks, createAttributionSentinelDecisionDeck, createAttributionSentinelEscalationMoments } from './playbooks-attribution-sentinel.mjs';

export function buildAttributionSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionSentinelWorkspace(workspaceName);
  const policies = createAttributionSentinelPolicies();
  return {
    workspace,
    summary: summarizeAttributionSentinelWorkspace(workspace),
    narratives: createAttributionSentinelNarratives(workspace),
    coverage: createAttributionSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionSentinelPolicies(policies),
    validation: validateAttributionSentinelPolicies(policies),
    escalationDeck: createAttributionSentinelEscalationDeck(policies),
    analytics: {
      timeline: createAttributionSentinelAnalyticsTimeline(),
      forecast: createAttributionSentinelForecastEnvelope(),
      exceptions: createAttributionSentinelExceptionLedger(),
      summary: summarizeAttributionSentinelAnalytics()
    },
    operations: {
      board: createAttributionSentinelOperationsBoard(),
      checklist: createAttributionSentinelShiftChecklist(),
      incidents: createAttributionSentinelIncidentDeck()
    },
    reporting: {
      cards: createAttributionSentinelReportCards(),
      packets: createAttributionSentinelReviewPackets(),
      summary: summarizeAttributionSentinelReporting()
    },
    audit: {
      trail: createAttributionSentinelAuditTrail(),
      manifest: createAttributionSentinelEvidenceManifest(),
      attestation: createAttributionSentinelReadinessAttestation()
    },
    playbooks: createAttributionSentinelPlaybooks(),
    decisions: createAttributionSentinelDecisionDeck(),
    escalationMoments: createAttributionSentinelEscalationMoments()
  };
}

export function createAttributionSentinelReadinessBoard(snapshot = buildAttributionSentinelSnapshot()) {
  return [
    { id: 'attribution-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionSentinelApiDocument(snapshot = buildAttributionSentinelSnapshot()) {
  return {
    id: 'attribution-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-sentinel/overview' },
      { method: 'GET', path: '/api/attribution-sentinel/reporting' },
      { method: 'POST', path: '/api/attribution-sentinel/validate' },
      { method: 'GET', path: '/api/attribution-sentinel/audit' }
    ],
    readiness: createAttributionSentinelReadinessBoard(snapshot)
  };
}

export function createAttributionSentinelRouteSummary(snapshot = buildAttributionSentinelSnapshot()) {
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

