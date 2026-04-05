import { createCollaborationSentinelWorkspace, summarizeCollaborationSentinelWorkspace, createCollaborationSentinelNarratives, createCollaborationSentinelCoverageGrid } from './domain-collaboration-sentinel.mjs';
import { createCollaborationSentinelPolicies, validateCollaborationSentinelPolicies, summarizeCollaborationSentinelPolicies, createCollaborationSentinelEscalationDeck } from './policies-collaboration-sentinel.mjs';
import { createCollaborationSentinelAnalyticsTimeline, createCollaborationSentinelForecastEnvelope, createCollaborationSentinelExceptionLedger, summarizeCollaborationSentinelAnalytics } from './analytics-collaboration-sentinel.mjs';
import { createCollaborationSentinelOperationsBoard, createCollaborationSentinelShiftChecklist, createCollaborationSentinelIncidentDeck } from './operations-collaboration-sentinel.mjs';
import { createCollaborationSentinelReportCards, createCollaborationSentinelReviewPackets, summarizeCollaborationSentinelReporting } from './reporting-collaboration-sentinel.mjs';
import { createCollaborationSentinelAuditTrail, createCollaborationSentinelEvidenceManifest, createCollaborationSentinelReadinessAttestation } from './audit-collaboration-sentinel.mjs';
import { createCollaborationSentinelPlaybooks, createCollaborationSentinelDecisionDeck, createCollaborationSentinelEscalationMoments } from './playbooks-collaboration-sentinel.mjs';

export function buildCollaborationSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationSentinelWorkspace(workspaceName);
  const policies = createCollaborationSentinelPolicies();
  return {
    workspace,
    summary: summarizeCollaborationSentinelWorkspace(workspace),
    narratives: createCollaborationSentinelNarratives(workspace),
    coverage: createCollaborationSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationSentinelPolicies(policies),
    validation: validateCollaborationSentinelPolicies(policies),
    escalationDeck: createCollaborationSentinelEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationSentinelAnalyticsTimeline(),
      forecast: createCollaborationSentinelForecastEnvelope(),
      exceptions: createCollaborationSentinelExceptionLedger(),
      summary: summarizeCollaborationSentinelAnalytics()
    },
    operations: {
      board: createCollaborationSentinelOperationsBoard(),
      checklist: createCollaborationSentinelShiftChecklist(),
      incidents: createCollaborationSentinelIncidentDeck()
    },
    reporting: {
      cards: createCollaborationSentinelReportCards(),
      packets: createCollaborationSentinelReviewPackets(),
      summary: summarizeCollaborationSentinelReporting()
    },
    audit: {
      trail: createCollaborationSentinelAuditTrail(),
      manifest: createCollaborationSentinelEvidenceManifest(),
      attestation: createCollaborationSentinelReadinessAttestation()
    },
    playbooks: createCollaborationSentinelPlaybooks(),
    decisions: createCollaborationSentinelDecisionDeck(),
    escalationMoments: createCollaborationSentinelEscalationMoments()
  };
}

export function createCollaborationSentinelReadinessBoard(snapshot = buildCollaborationSentinelSnapshot()) {
  return [
    { id: 'collaboration-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationSentinelApiDocument(snapshot = buildCollaborationSentinelSnapshot()) {
  return {
    id: 'collaboration-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-sentinel/overview' },
      { method: 'GET', path: '/api/collaboration-sentinel/reporting' },
      { method: 'POST', path: '/api/collaboration-sentinel/validate' },
      { method: 'GET', path: '/api/collaboration-sentinel/audit' }
    ],
    readiness: createCollaborationSentinelReadinessBoard(snapshot)
  };
}

export function createCollaborationSentinelRouteSummary(snapshot = buildCollaborationSentinelSnapshot()) {
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

