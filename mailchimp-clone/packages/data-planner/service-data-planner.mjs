import { createDataPlannerWorkspace, summarizeDataPlannerWorkspace, createDataPlannerNarratives, createDataPlannerCoverageGrid } from './domain-data-planner.mjs';
import { createDataPlannerPolicies, validateDataPlannerPolicies, summarizeDataPlannerPolicies, createDataPlannerEscalationDeck } from './policies-data-planner.mjs';
import { createDataPlannerAnalyticsTimeline, createDataPlannerForecastEnvelope, createDataPlannerExceptionLedger, summarizeDataPlannerAnalytics } from './analytics-data-planner.mjs';
import { createDataPlannerOperationsBoard, createDataPlannerShiftChecklist, createDataPlannerIncidentDeck } from './operations-data-planner.mjs';
import { createDataPlannerReportCards, createDataPlannerReviewPackets, summarizeDataPlannerReporting } from './reporting-data-planner.mjs';
import { createDataPlannerAuditTrail, createDataPlannerEvidenceManifest, createDataPlannerReadinessAttestation } from './audit-data-planner.mjs';
import { createDataPlannerPlaybooks, createDataPlannerDecisionDeck, createDataPlannerEscalationMoments } from './playbooks-data-planner.mjs';

export function buildDataPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataPlannerWorkspace(workspaceName);
  const policies = createDataPlannerPolicies();
  return {
    workspace,
    summary: summarizeDataPlannerWorkspace(workspace),
    narratives: createDataPlannerNarratives(workspace),
    coverage: createDataPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataPlannerPolicies(policies),
    validation: validateDataPlannerPolicies(policies),
    escalationDeck: createDataPlannerEscalationDeck(policies),
    analytics: {
      timeline: createDataPlannerAnalyticsTimeline(),
      forecast: createDataPlannerForecastEnvelope(),
      exceptions: createDataPlannerExceptionLedger(),
      summary: summarizeDataPlannerAnalytics()
    },
    operations: {
      board: createDataPlannerOperationsBoard(),
      checklist: createDataPlannerShiftChecklist(),
      incidents: createDataPlannerIncidentDeck()
    },
    reporting: {
      cards: createDataPlannerReportCards(),
      packets: createDataPlannerReviewPackets(),
      summary: summarizeDataPlannerReporting()
    },
    audit: {
      trail: createDataPlannerAuditTrail(),
      manifest: createDataPlannerEvidenceManifest(),
      attestation: createDataPlannerReadinessAttestation()
    },
    playbooks: createDataPlannerPlaybooks(),
    decisions: createDataPlannerDecisionDeck(),
    escalationMoments: createDataPlannerEscalationMoments()
  };
}

export function createDataPlannerReadinessBoard(snapshot = buildDataPlannerSnapshot()) {
  return [
    { id: 'data-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataPlannerApiDocument(snapshot = buildDataPlannerSnapshot()) {
  return {
    id: 'data-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-planner/overview' },
      { method: 'GET', path: '/api/data-planner/reporting' },
      { method: 'POST', path: '/api/data-planner/validate' },
      { method: 'GET', path: '/api/data-planner/audit' }
    ],
    readiness: createDataPlannerReadinessBoard(snapshot)
  };
}

export function createDataPlannerRouteSummary(snapshot = buildDataPlannerSnapshot()) {
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

