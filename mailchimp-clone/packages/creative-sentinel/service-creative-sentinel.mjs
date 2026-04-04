import { createCreativeSentinelWorkspace, summarizeCreativeSentinelWorkspace, createCreativeSentinelNarratives, createCreativeSentinelCoverageGrid } from './domain-creative-sentinel.mjs';
import { createCreativeSentinelPolicies, validateCreativeSentinelPolicies, summarizeCreativeSentinelPolicies, createCreativeSentinelEscalationDeck } from './policies-creative-sentinel.mjs';
import { createCreativeSentinelAnalyticsTimeline, createCreativeSentinelForecastEnvelope, createCreativeSentinelExceptionLedger, summarizeCreativeSentinelAnalytics } from './analytics-creative-sentinel.mjs';
import { createCreativeSentinelOperationsBoard, createCreativeSentinelShiftChecklist, createCreativeSentinelIncidentDeck } from './operations-creative-sentinel.mjs';
import { createCreativeSentinelReportCards, createCreativeSentinelReviewPackets, summarizeCreativeSentinelReporting } from './reporting-creative-sentinel.mjs';
import { createCreativeSentinelAuditTrail, createCreativeSentinelEvidenceManifest, createCreativeSentinelReadinessAttestation } from './audit-creative-sentinel.mjs';
import { createCreativeSentinelPlaybooks, createCreativeSentinelDecisionDeck, createCreativeSentinelEscalationMoments } from './playbooks-creative-sentinel.mjs';

export function buildCreativeSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeSentinelWorkspace(workspaceName);
  const policies = createCreativeSentinelPolicies();
  return {
    workspace,
    summary: summarizeCreativeSentinelWorkspace(workspace),
    narratives: createCreativeSentinelNarratives(workspace),
    coverage: createCreativeSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeSentinelPolicies(policies),
    validation: validateCreativeSentinelPolicies(policies),
    escalationDeck: createCreativeSentinelEscalationDeck(policies),
    analytics: {
      timeline: createCreativeSentinelAnalyticsTimeline(),
      forecast: createCreativeSentinelForecastEnvelope(),
      exceptions: createCreativeSentinelExceptionLedger(),
      summary: summarizeCreativeSentinelAnalytics()
    },
    operations: {
      board: createCreativeSentinelOperationsBoard(),
      checklist: createCreativeSentinelShiftChecklist(),
      incidents: createCreativeSentinelIncidentDeck()
    },
    reporting: {
      cards: createCreativeSentinelReportCards(),
      packets: createCreativeSentinelReviewPackets(),
      summary: summarizeCreativeSentinelReporting()
    },
    audit: {
      trail: createCreativeSentinelAuditTrail(),
      manifest: createCreativeSentinelEvidenceManifest(),
      attestation: createCreativeSentinelReadinessAttestation()
    },
    playbooks: createCreativeSentinelPlaybooks(),
    decisions: createCreativeSentinelDecisionDeck(),
    escalationMoments: createCreativeSentinelEscalationMoments()
  };
}

export function createCreativeSentinelReadinessBoard(snapshot = buildCreativeSentinelSnapshot()) {
  return [
    { id: 'creative-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeSentinelApiDocument(snapshot = buildCreativeSentinelSnapshot()) {
  return {
    id: 'creative-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-sentinel/overview' },
      { method: 'GET', path: '/api/creative-sentinel/reporting' },
      { method: 'POST', path: '/api/creative-sentinel/validate' },
      { method: 'GET', path: '/api/creative-sentinel/audit' }
    ],
    readiness: createCreativeSentinelReadinessBoard(snapshot)
  };
}

export function createCreativeSentinelRouteSummary(snapshot = buildCreativeSentinelSnapshot()) {
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

