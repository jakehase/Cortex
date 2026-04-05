import { createExperimentationSentinelWorkspace, summarizeExperimentationSentinelWorkspace, createExperimentationSentinelNarratives, createExperimentationSentinelCoverageGrid } from './domain-experimentation-sentinel.mjs';
import { createExperimentationSentinelPolicies, validateExperimentationSentinelPolicies, summarizeExperimentationSentinelPolicies, createExperimentationSentinelEscalationDeck } from './policies-experimentation-sentinel.mjs';
import { createExperimentationSentinelAnalyticsTimeline, createExperimentationSentinelForecastEnvelope, createExperimentationSentinelExceptionLedger, summarizeExperimentationSentinelAnalytics } from './analytics-experimentation-sentinel.mjs';
import { createExperimentationSentinelOperationsBoard, createExperimentationSentinelShiftChecklist, createExperimentationSentinelIncidentDeck } from './operations-experimentation-sentinel.mjs';
import { createExperimentationSentinelReportCards, createExperimentationSentinelReviewPackets, summarizeExperimentationSentinelReporting } from './reporting-experimentation-sentinel.mjs';
import { createExperimentationSentinelAuditTrail, createExperimentationSentinelEvidenceManifest, createExperimentationSentinelReadinessAttestation } from './audit-experimentation-sentinel.mjs';
import { createExperimentationSentinelPlaybooks, createExperimentationSentinelDecisionDeck, createExperimentationSentinelEscalationMoments } from './playbooks-experimentation-sentinel.mjs';

export function buildExperimentationSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationSentinelWorkspace(workspaceName);
  const policies = createExperimentationSentinelPolicies();
  return {
    workspace,
    summary: summarizeExperimentationSentinelWorkspace(workspace),
    narratives: createExperimentationSentinelNarratives(workspace),
    coverage: createExperimentationSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationSentinelPolicies(policies),
    validation: validateExperimentationSentinelPolicies(policies),
    escalationDeck: createExperimentationSentinelEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationSentinelAnalyticsTimeline(),
      forecast: createExperimentationSentinelForecastEnvelope(),
      exceptions: createExperimentationSentinelExceptionLedger(),
      summary: summarizeExperimentationSentinelAnalytics()
    },
    operations: {
      board: createExperimentationSentinelOperationsBoard(),
      checklist: createExperimentationSentinelShiftChecklist(),
      incidents: createExperimentationSentinelIncidentDeck()
    },
    reporting: {
      cards: createExperimentationSentinelReportCards(),
      packets: createExperimentationSentinelReviewPackets(),
      summary: summarizeExperimentationSentinelReporting()
    },
    audit: {
      trail: createExperimentationSentinelAuditTrail(),
      manifest: createExperimentationSentinelEvidenceManifest(),
      attestation: createExperimentationSentinelReadinessAttestation()
    },
    playbooks: createExperimentationSentinelPlaybooks(),
    decisions: createExperimentationSentinelDecisionDeck(),
    escalationMoments: createExperimentationSentinelEscalationMoments()
  };
}

export function createExperimentationSentinelReadinessBoard(snapshot = buildExperimentationSentinelSnapshot()) {
  return [
    { id: 'experimentation-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationSentinelApiDocument(snapshot = buildExperimentationSentinelSnapshot()) {
  return {
    id: 'experimentation-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-sentinel/overview' },
      { method: 'GET', path: '/api/experimentation-sentinel/reporting' },
      { method: 'POST', path: '/api/experimentation-sentinel/validate' },
      { method: 'GET', path: '/api/experimentation-sentinel/audit' }
    ],
    readiness: createExperimentationSentinelReadinessBoard(snapshot)
  };
}

export function createExperimentationSentinelRouteSummary(snapshot = buildExperimentationSentinelSnapshot()) {
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

