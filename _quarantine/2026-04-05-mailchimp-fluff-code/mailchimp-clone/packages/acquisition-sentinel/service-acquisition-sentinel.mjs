import { createAcquisitionSentinelWorkspace, summarizeAcquisitionSentinelWorkspace, createAcquisitionSentinelNarratives, createAcquisitionSentinelCoverageGrid } from './domain-acquisition-sentinel.mjs';
import { createAcquisitionSentinelPolicies, validateAcquisitionSentinelPolicies, summarizeAcquisitionSentinelPolicies, createAcquisitionSentinelEscalationDeck } from './policies-acquisition-sentinel.mjs';
import { createAcquisitionSentinelAnalyticsTimeline, createAcquisitionSentinelForecastEnvelope, createAcquisitionSentinelExceptionLedger, summarizeAcquisitionSentinelAnalytics } from './analytics-acquisition-sentinel.mjs';
import { createAcquisitionSentinelOperationsBoard, createAcquisitionSentinelShiftChecklist, createAcquisitionSentinelIncidentDeck } from './operations-acquisition-sentinel.mjs';
import { createAcquisitionSentinelReportCards, createAcquisitionSentinelReviewPackets, summarizeAcquisitionSentinelReporting } from './reporting-acquisition-sentinel.mjs';
import { createAcquisitionSentinelAuditTrail, createAcquisitionSentinelEvidenceManifest, createAcquisitionSentinelReadinessAttestation } from './audit-acquisition-sentinel.mjs';
import { createAcquisitionSentinelPlaybooks, createAcquisitionSentinelDecisionDeck, createAcquisitionSentinelEscalationMoments } from './playbooks-acquisition-sentinel.mjs';

export function buildAcquisitionSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionSentinelWorkspace(workspaceName);
  const policies = createAcquisitionSentinelPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionSentinelWorkspace(workspace),
    narratives: createAcquisitionSentinelNarratives(workspace),
    coverage: createAcquisitionSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionSentinelPolicies(policies),
    validation: validateAcquisitionSentinelPolicies(policies),
    escalationDeck: createAcquisitionSentinelEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionSentinelAnalyticsTimeline(),
      forecast: createAcquisitionSentinelForecastEnvelope(),
      exceptions: createAcquisitionSentinelExceptionLedger(),
      summary: summarizeAcquisitionSentinelAnalytics()
    },
    operations: {
      board: createAcquisitionSentinelOperationsBoard(),
      checklist: createAcquisitionSentinelShiftChecklist(),
      incidents: createAcquisitionSentinelIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionSentinelReportCards(),
      packets: createAcquisitionSentinelReviewPackets(),
      summary: summarizeAcquisitionSentinelReporting()
    },
    audit: {
      trail: createAcquisitionSentinelAuditTrail(),
      manifest: createAcquisitionSentinelEvidenceManifest(),
      attestation: createAcquisitionSentinelReadinessAttestation()
    },
    playbooks: createAcquisitionSentinelPlaybooks(),
    decisions: createAcquisitionSentinelDecisionDeck(),
    escalationMoments: createAcquisitionSentinelEscalationMoments()
  };
}

export function createAcquisitionSentinelReadinessBoard(snapshot = buildAcquisitionSentinelSnapshot()) {
  return [
    { id: 'acquisition-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionSentinelApiDocument(snapshot = buildAcquisitionSentinelSnapshot()) {
  return {
    id: 'acquisition-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-sentinel/overview' },
      { method: 'GET', path: '/api/acquisition-sentinel/reporting' },
      { method: 'POST', path: '/api/acquisition-sentinel/validate' },
      { method: 'GET', path: '/api/acquisition-sentinel/audit' }
    ],
    readiness: createAcquisitionSentinelReadinessBoard(snapshot)
  };
}

export function createAcquisitionSentinelRouteSummary(snapshot = buildAcquisitionSentinelSnapshot()) {
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

