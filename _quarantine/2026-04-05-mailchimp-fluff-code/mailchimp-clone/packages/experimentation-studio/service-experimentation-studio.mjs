import { createExperimentationStudioWorkspace, summarizeExperimentationStudioWorkspace, createExperimentationStudioNarratives, createExperimentationStudioCoverageGrid } from './domain-experimentation-studio.mjs';
import { createExperimentationStudioPolicies, validateExperimentationStudioPolicies, summarizeExperimentationStudioPolicies, createExperimentationStudioEscalationDeck } from './policies-experimentation-studio.mjs';
import { createExperimentationStudioAnalyticsTimeline, createExperimentationStudioForecastEnvelope, createExperimentationStudioExceptionLedger, summarizeExperimentationStudioAnalytics } from './analytics-experimentation-studio.mjs';
import { createExperimentationStudioOperationsBoard, createExperimentationStudioShiftChecklist, createExperimentationStudioIncidentDeck } from './operations-experimentation-studio.mjs';
import { createExperimentationStudioReportCards, createExperimentationStudioReviewPackets, summarizeExperimentationStudioReporting } from './reporting-experimentation-studio.mjs';
import { createExperimentationStudioAuditTrail, createExperimentationStudioEvidenceManifest, createExperimentationStudioReadinessAttestation } from './audit-experimentation-studio.mjs';
import { createExperimentationStudioPlaybooks, createExperimentationStudioDecisionDeck, createExperimentationStudioEscalationMoments } from './playbooks-experimentation-studio.mjs';

export function buildExperimentationStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationStudioWorkspace(workspaceName);
  const policies = createExperimentationStudioPolicies();
  return {
    workspace,
    summary: summarizeExperimentationStudioWorkspace(workspace),
    narratives: createExperimentationStudioNarratives(workspace),
    coverage: createExperimentationStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationStudioPolicies(policies),
    validation: validateExperimentationStudioPolicies(policies),
    escalationDeck: createExperimentationStudioEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationStudioAnalyticsTimeline(),
      forecast: createExperimentationStudioForecastEnvelope(),
      exceptions: createExperimentationStudioExceptionLedger(),
      summary: summarizeExperimentationStudioAnalytics()
    },
    operations: {
      board: createExperimentationStudioOperationsBoard(),
      checklist: createExperimentationStudioShiftChecklist(),
      incidents: createExperimentationStudioIncidentDeck()
    },
    reporting: {
      cards: createExperimentationStudioReportCards(),
      packets: createExperimentationStudioReviewPackets(),
      summary: summarizeExperimentationStudioReporting()
    },
    audit: {
      trail: createExperimentationStudioAuditTrail(),
      manifest: createExperimentationStudioEvidenceManifest(),
      attestation: createExperimentationStudioReadinessAttestation()
    },
    playbooks: createExperimentationStudioPlaybooks(),
    decisions: createExperimentationStudioDecisionDeck(),
    escalationMoments: createExperimentationStudioEscalationMoments()
  };
}

export function createExperimentationStudioReadinessBoard(snapshot = buildExperimentationStudioSnapshot()) {
  return [
    { id: 'experimentation-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationStudioApiDocument(snapshot = buildExperimentationStudioSnapshot()) {
  return {
    id: 'experimentation-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-studio/overview' },
      { method: 'GET', path: '/api/experimentation-studio/reporting' },
      { method: 'POST', path: '/api/experimentation-studio/validate' },
      { method: 'GET', path: '/api/experimentation-studio/audit' }
    ],
    readiness: createExperimentationStudioReadinessBoard(snapshot)
  };
}

export function createExperimentationStudioRouteSummary(snapshot = buildExperimentationStudioSnapshot()) {
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

