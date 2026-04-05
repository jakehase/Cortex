import { createActivationSentinelWorkspace, summarizeActivationSentinelWorkspace, createActivationSentinelNarratives, createActivationSentinelCoverageGrid } from './domain-activation-sentinel.mjs';
import { createActivationSentinelPolicies, validateActivationSentinelPolicies, summarizeActivationSentinelPolicies, createActivationSentinelEscalationDeck } from './policies-activation-sentinel.mjs';
import { createActivationSentinelAnalyticsTimeline, createActivationSentinelForecastEnvelope, createActivationSentinelExceptionLedger, summarizeActivationSentinelAnalytics } from './analytics-activation-sentinel.mjs';
import { createActivationSentinelOperationsBoard, createActivationSentinelShiftChecklist, createActivationSentinelIncidentDeck } from './operations-activation-sentinel.mjs';
import { createActivationSentinelReportCards, createActivationSentinelReviewPackets, summarizeActivationSentinelReporting } from './reporting-activation-sentinel.mjs';
import { createActivationSentinelAuditTrail, createActivationSentinelEvidenceManifest, createActivationSentinelReadinessAttestation } from './audit-activation-sentinel.mjs';
import { createActivationSentinelPlaybooks, createActivationSentinelDecisionDeck, createActivationSentinelEscalationMoments } from './playbooks-activation-sentinel.mjs';

export function buildActivationSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationSentinelWorkspace(workspaceName);
  const policies = createActivationSentinelPolicies();
  return {
    workspace,
    summary: summarizeActivationSentinelWorkspace(workspace),
    narratives: createActivationSentinelNarratives(workspace),
    coverage: createActivationSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationSentinelPolicies(policies),
    validation: validateActivationSentinelPolicies(policies),
    escalationDeck: createActivationSentinelEscalationDeck(policies),
    analytics: {
      timeline: createActivationSentinelAnalyticsTimeline(),
      forecast: createActivationSentinelForecastEnvelope(),
      exceptions: createActivationSentinelExceptionLedger(),
      summary: summarizeActivationSentinelAnalytics()
    },
    operations: {
      board: createActivationSentinelOperationsBoard(),
      checklist: createActivationSentinelShiftChecklist(),
      incidents: createActivationSentinelIncidentDeck()
    },
    reporting: {
      cards: createActivationSentinelReportCards(),
      packets: createActivationSentinelReviewPackets(),
      summary: summarizeActivationSentinelReporting()
    },
    audit: {
      trail: createActivationSentinelAuditTrail(),
      manifest: createActivationSentinelEvidenceManifest(),
      attestation: createActivationSentinelReadinessAttestation()
    },
    playbooks: createActivationSentinelPlaybooks(),
    decisions: createActivationSentinelDecisionDeck(),
    escalationMoments: createActivationSentinelEscalationMoments()
  };
}

export function createActivationSentinelReadinessBoard(snapshot = buildActivationSentinelSnapshot()) {
  return [
    { id: 'activation-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationSentinelApiDocument(snapshot = buildActivationSentinelSnapshot()) {
  return {
    id: 'activation-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-sentinel/overview' },
      { method: 'GET', path: '/api/activation-sentinel/reporting' },
      { method: 'POST', path: '/api/activation-sentinel/validate' },
      { method: 'GET', path: '/api/activation-sentinel/audit' }
    ],
    readiness: createActivationSentinelReadinessBoard(snapshot)
  };
}

export function createActivationSentinelRouteSummary(snapshot = buildActivationSentinelSnapshot()) {
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

