import { createDeliverabilitySentinelWorkspace, summarizeDeliverabilitySentinelWorkspace, createDeliverabilitySentinelNarratives, createDeliverabilitySentinelCoverageGrid } from './domain-deliverability-sentinel.mjs';
import { createDeliverabilitySentinelPolicies, validateDeliverabilitySentinelPolicies, summarizeDeliverabilitySentinelPolicies, createDeliverabilitySentinelEscalationDeck } from './policies-deliverability-sentinel.mjs';
import { createDeliverabilitySentinelAnalyticsTimeline, createDeliverabilitySentinelForecastEnvelope, createDeliverabilitySentinelExceptionLedger, summarizeDeliverabilitySentinelAnalytics } from './analytics-deliverability-sentinel.mjs';
import { createDeliverabilitySentinelOperationsBoard, createDeliverabilitySentinelShiftChecklist, createDeliverabilitySentinelIncidentDeck } from './operations-deliverability-sentinel.mjs';
import { createDeliverabilitySentinelReportCards, createDeliverabilitySentinelReviewPackets, summarizeDeliverabilitySentinelReporting } from './reporting-deliverability-sentinel.mjs';
import { createDeliverabilitySentinelAuditTrail, createDeliverabilitySentinelEvidenceManifest, createDeliverabilitySentinelReadinessAttestation } from './audit-deliverability-sentinel.mjs';
import { createDeliverabilitySentinelPlaybooks, createDeliverabilitySentinelDecisionDeck, createDeliverabilitySentinelEscalationMoments } from './playbooks-deliverability-sentinel.mjs';

export function buildDeliverabilitySentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilitySentinelWorkspace(workspaceName);
  const policies = createDeliverabilitySentinelPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilitySentinelWorkspace(workspace),
    narratives: createDeliverabilitySentinelNarratives(workspace),
    coverage: createDeliverabilitySentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilitySentinelPolicies(policies),
    validation: validateDeliverabilitySentinelPolicies(policies),
    escalationDeck: createDeliverabilitySentinelEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilitySentinelAnalyticsTimeline(),
      forecast: createDeliverabilitySentinelForecastEnvelope(),
      exceptions: createDeliverabilitySentinelExceptionLedger(),
      summary: summarizeDeliverabilitySentinelAnalytics()
    },
    operations: {
      board: createDeliverabilitySentinelOperationsBoard(),
      checklist: createDeliverabilitySentinelShiftChecklist(),
      incidents: createDeliverabilitySentinelIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilitySentinelReportCards(),
      packets: createDeliverabilitySentinelReviewPackets(),
      summary: summarizeDeliverabilitySentinelReporting()
    },
    audit: {
      trail: createDeliverabilitySentinelAuditTrail(),
      manifest: createDeliverabilitySentinelEvidenceManifest(),
      attestation: createDeliverabilitySentinelReadinessAttestation()
    },
    playbooks: createDeliverabilitySentinelPlaybooks(),
    decisions: createDeliverabilitySentinelDecisionDeck(),
    escalationMoments: createDeliverabilitySentinelEscalationMoments()
  };
}

export function createDeliverabilitySentinelReadinessBoard(snapshot = buildDeliverabilitySentinelSnapshot()) {
  return [
    { id: 'deliverability-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilitySentinelApiDocument(snapshot = buildDeliverabilitySentinelSnapshot()) {
  return {
    id: 'deliverability-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-sentinel/overview' },
      { method: 'GET', path: '/api/deliverability-sentinel/reporting' },
      { method: 'POST', path: '/api/deliverability-sentinel/validate' },
      { method: 'GET', path: '/api/deliverability-sentinel/audit' }
    ],
    readiness: createDeliverabilitySentinelReadinessBoard(snapshot)
  };
}

export function createDeliverabilitySentinelRouteSummary(snapshot = buildDeliverabilitySentinelSnapshot()) {
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

