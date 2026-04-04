import { createAudienceSentinelWorkspace, summarizeAudienceSentinelWorkspace, createAudienceSentinelNarratives, createAudienceSentinelCoverageGrid } from './domain-audience-sentinel.mjs';
import { createAudienceSentinelPolicies, validateAudienceSentinelPolicies, summarizeAudienceSentinelPolicies, createAudienceSentinelEscalationDeck } from './policies-audience-sentinel.mjs';
import { createAudienceSentinelAnalyticsTimeline, createAudienceSentinelForecastEnvelope, createAudienceSentinelExceptionLedger, summarizeAudienceSentinelAnalytics } from './analytics-audience-sentinel.mjs';
import { createAudienceSentinelOperationsBoard, createAudienceSentinelShiftChecklist, createAudienceSentinelIncidentDeck } from './operations-audience-sentinel.mjs';
import { createAudienceSentinelReportCards, createAudienceSentinelReviewPackets, summarizeAudienceSentinelReporting } from './reporting-audience-sentinel.mjs';
import { createAudienceSentinelAuditTrail, createAudienceSentinelEvidenceManifest, createAudienceSentinelReadinessAttestation } from './audit-audience-sentinel.mjs';
import { createAudienceSentinelPlaybooks, createAudienceSentinelDecisionDeck, createAudienceSentinelEscalationMoments } from './playbooks-audience-sentinel.mjs';

export function buildAudienceSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceSentinelWorkspace(workspaceName);
  const policies = createAudienceSentinelPolicies();
  return {
    workspace,
    summary: summarizeAudienceSentinelWorkspace(workspace),
    narratives: createAudienceSentinelNarratives(workspace),
    coverage: createAudienceSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceSentinelPolicies(policies),
    validation: validateAudienceSentinelPolicies(policies),
    escalationDeck: createAudienceSentinelEscalationDeck(policies),
    analytics: {
      timeline: createAudienceSentinelAnalyticsTimeline(),
      forecast: createAudienceSentinelForecastEnvelope(),
      exceptions: createAudienceSentinelExceptionLedger(),
      summary: summarizeAudienceSentinelAnalytics()
    },
    operations: {
      board: createAudienceSentinelOperationsBoard(),
      checklist: createAudienceSentinelShiftChecklist(),
      incidents: createAudienceSentinelIncidentDeck()
    },
    reporting: {
      cards: createAudienceSentinelReportCards(),
      packets: createAudienceSentinelReviewPackets(),
      summary: summarizeAudienceSentinelReporting()
    },
    audit: {
      trail: createAudienceSentinelAuditTrail(),
      manifest: createAudienceSentinelEvidenceManifest(),
      attestation: createAudienceSentinelReadinessAttestation()
    },
    playbooks: createAudienceSentinelPlaybooks(),
    decisions: createAudienceSentinelDecisionDeck(),
    escalationMoments: createAudienceSentinelEscalationMoments()
  };
}

export function createAudienceSentinelReadinessBoard(snapshot = buildAudienceSentinelSnapshot()) {
  return [
    { id: 'audience-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceSentinelApiDocument(snapshot = buildAudienceSentinelSnapshot()) {
  return {
    id: 'audience-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-sentinel/overview' },
      { method: 'GET', path: '/api/audience-sentinel/reporting' },
      { method: 'POST', path: '/api/audience-sentinel/validate' },
      { method: 'GET', path: '/api/audience-sentinel/audit' }
    ],
    readiness: createAudienceSentinelReadinessBoard(snapshot)
  };
}

export function createAudienceSentinelRouteSummary(snapshot = buildAudienceSentinelSnapshot()) {
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

