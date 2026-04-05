import { createAttributionPlannerWorkspace, summarizeAttributionPlannerWorkspace, createAttributionPlannerNarratives, createAttributionPlannerCoverageGrid } from './domain-attribution-planner.mjs';
import { createAttributionPlannerPolicies, validateAttributionPlannerPolicies, summarizeAttributionPlannerPolicies, createAttributionPlannerEscalationDeck } from './policies-attribution-planner.mjs';
import { createAttributionPlannerAnalyticsTimeline, createAttributionPlannerForecastEnvelope, createAttributionPlannerExceptionLedger, summarizeAttributionPlannerAnalytics } from './analytics-attribution-planner.mjs';
import { createAttributionPlannerOperationsBoard, createAttributionPlannerShiftChecklist, createAttributionPlannerIncidentDeck } from './operations-attribution-planner.mjs';
import { createAttributionPlannerReportCards, createAttributionPlannerReviewPackets, summarizeAttributionPlannerReporting } from './reporting-attribution-planner.mjs';
import { createAttributionPlannerAuditTrail, createAttributionPlannerEvidenceManifest, createAttributionPlannerReadinessAttestation } from './audit-attribution-planner.mjs';
import { createAttributionPlannerPlaybooks, createAttributionPlannerDecisionDeck, createAttributionPlannerEscalationMoments } from './playbooks-attribution-planner.mjs';

export function buildAttributionPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionPlannerWorkspace(workspaceName);
  const policies = createAttributionPlannerPolicies();
  return {
    workspace,
    summary: summarizeAttributionPlannerWorkspace(workspace),
    narratives: createAttributionPlannerNarratives(workspace),
    coverage: createAttributionPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionPlannerPolicies(policies),
    validation: validateAttributionPlannerPolicies(policies),
    escalationDeck: createAttributionPlannerEscalationDeck(policies),
    analytics: {
      timeline: createAttributionPlannerAnalyticsTimeline(),
      forecast: createAttributionPlannerForecastEnvelope(),
      exceptions: createAttributionPlannerExceptionLedger(),
      summary: summarizeAttributionPlannerAnalytics()
    },
    operations: {
      board: createAttributionPlannerOperationsBoard(),
      checklist: createAttributionPlannerShiftChecklist(),
      incidents: createAttributionPlannerIncidentDeck()
    },
    reporting: {
      cards: createAttributionPlannerReportCards(),
      packets: createAttributionPlannerReviewPackets(),
      summary: summarizeAttributionPlannerReporting()
    },
    audit: {
      trail: createAttributionPlannerAuditTrail(),
      manifest: createAttributionPlannerEvidenceManifest(),
      attestation: createAttributionPlannerReadinessAttestation()
    },
    playbooks: createAttributionPlannerPlaybooks(),
    decisions: createAttributionPlannerDecisionDeck(),
    escalationMoments: createAttributionPlannerEscalationMoments()
  };
}

export function createAttributionPlannerReadinessBoard(snapshot = buildAttributionPlannerSnapshot()) {
  return [
    { id: 'attribution-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionPlannerApiDocument(snapshot = buildAttributionPlannerSnapshot()) {
  return {
    id: 'attribution-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-planner/overview' },
      { method: 'GET', path: '/api/attribution-planner/reporting' },
      { method: 'POST', path: '/api/attribution-planner/validate' },
      { method: 'GET', path: '/api/attribution-planner/audit' }
    ],
    readiness: createAttributionPlannerReadinessBoard(snapshot)
  };
}

export function createAttributionPlannerRouteSummary(snapshot = buildAttributionPlannerSnapshot()) {
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

