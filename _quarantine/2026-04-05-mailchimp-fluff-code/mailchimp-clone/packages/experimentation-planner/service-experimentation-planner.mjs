import { createExperimentationPlannerWorkspace, summarizeExperimentationPlannerWorkspace, createExperimentationPlannerNarratives, createExperimentationPlannerCoverageGrid } from './domain-experimentation-planner.mjs';
import { createExperimentationPlannerPolicies, validateExperimentationPlannerPolicies, summarizeExperimentationPlannerPolicies, createExperimentationPlannerEscalationDeck } from './policies-experimentation-planner.mjs';
import { createExperimentationPlannerAnalyticsTimeline, createExperimentationPlannerForecastEnvelope, createExperimentationPlannerExceptionLedger, summarizeExperimentationPlannerAnalytics } from './analytics-experimentation-planner.mjs';
import { createExperimentationPlannerOperationsBoard, createExperimentationPlannerShiftChecklist, createExperimentationPlannerIncidentDeck } from './operations-experimentation-planner.mjs';
import { createExperimentationPlannerReportCards, createExperimentationPlannerReviewPackets, summarizeExperimentationPlannerReporting } from './reporting-experimentation-planner.mjs';
import { createExperimentationPlannerAuditTrail, createExperimentationPlannerEvidenceManifest, createExperimentationPlannerReadinessAttestation } from './audit-experimentation-planner.mjs';
import { createExperimentationPlannerPlaybooks, createExperimentationPlannerDecisionDeck, createExperimentationPlannerEscalationMoments } from './playbooks-experimentation-planner.mjs';

export function buildExperimentationPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationPlannerWorkspace(workspaceName);
  const policies = createExperimentationPlannerPolicies();
  return {
    workspace,
    summary: summarizeExperimentationPlannerWorkspace(workspace),
    narratives: createExperimentationPlannerNarratives(workspace),
    coverage: createExperimentationPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationPlannerPolicies(policies),
    validation: validateExperimentationPlannerPolicies(policies),
    escalationDeck: createExperimentationPlannerEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationPlannerAnalyticsTimeline(),
      forecast: createExperimentationPlannerForecastEnvelope(),
      exceptions: createExperimentationPlannerExceptionLedger(),
      summary: summarizeExperimentationPlannerAnalytics()
    },
    operations: {
      board: createExperimentationPlannerOperationsBoard(),
      checklist: createExperimentationPlannerShiftChecklist(),
      incidents: createExperimentationPlannerIncidentDeck()
    },
    reporting: {
      cards: createExperimentationPlannerReportCards(),
      packets: createExperimentationPlannerReviewPackets(),
      summary: summarizeExperimentationPlannerReporting()
    },
    audit: {
      trail: createExperimentationPlannerAuditTrail(),
      manifest: createExperimentationPlannerEvidenceManifest(),
      attestation: createExperimentationPlannerReadinessAttestation()
    },
    playbooks: createExperimentationPlannerPlaybooks(),
    decisions: createExperimentationPlannerDecisionDeck(),
    escalationMoments: createExperimentationPlannerEscalationMoments()
  };
}

export function createExperimentationPlannerReadinessBoard(snapshot = buildExperimentationPlannerSnapshot()) {
  return [
    { id: 'experimentation-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationPlannerApiDocument(snapshot = buildExperimentationPlannerSnapshot()) {
  return {
    id: 'experimentation-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-planner/overview' },
      { method: 'GET', path: '/api/experimentation-planner/reporting' },
      { method: 'POST', path: '/api/experimentation-planner/validate' },
      { method: 'GET', path: '/api/experimentation-planner/audit' }
    ],
    readiness: createExperimentationPlannerReadinessBoard(snapshot)
  };
}

export function createExperimentationPlannerRouteSummary(snapshot = buildExperimentationPlannerSnapshot()) {
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

