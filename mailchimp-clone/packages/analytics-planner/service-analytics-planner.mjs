import { createAnalyticsPlannerWorkspace, summarizeAnalyticsPlannerWorkspace, createAnalyticsPlannerNarratives, createAnalyticsPlannerCoverageGrid } from './domain-analytics-planner.mjs';
import { createAnalyticsPlannerPolicies, validateAnalyticsPlannerPolicies, summarizeAnalyticsPlannerPolicies, createAnalyticsPlannerEscalationDeck } from './policies-analytics-planner.mjs';
import { createAnalyticsPlannerAnalyticsTimeline, createAnalyticsPlannerForecastEnvelope, createAnalyticsPlannerExceptionLedger, summarizeAnalyticsPlannerAnalytics } from './analytics-analytics-planner.mjs';
import { createAnalyticsPlannerOperationsBoard, createAnalyticsPlannerShiftChecklist, createAnalyticsPlannerIncidentDeck } from './operations-analytics-planner.mjs';
import { createAnalyticsPlannerReportCards, createAnalyticsPlannerReviewPackets, summarizeAnalyticsPlannerReporting } from './reporting-analytics-planner.mjs';
import { createAnalyticsPlannerAuditTrail, createAnalyticsPlannerEvidenceManifest, createAnalyticsPlannerReadinessAttestation } from './audit-analytics-planner.mjs';
import { createAnalyticsPlannerPlaybooks, createAnalyticsPlannerDecisionDeck, createAnalyticsPlannerEscalationMoments } from './playbooks-analytics-planner.mjs';

export function buildAnalyticsPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsPlannerWorkspace(workspaceName);
  const policies = createAnalyticsPlannerPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsPlannerWorkspace(workspace),
    narratives: createAnalyticsPlannerNarratives(workspace),
    coverage: createAnalyticsPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsPlannerPolicies(policies),
    validation: validateAnalyticsPlannerPolicies(policies),
    escalationDeck: createAnalyticsPlannerEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsPlannerAnalyticsTimeline(),
      forecast: createAnalyticsPlannerForecastEnvelope(),
      exceptions: createAnalyticsPlannerExceptionLedger(),
      summary: summarizeAnalyticsPlannerAnalytics()
    },
    operations: {
      board: createAnalyticsPlannerOperationsBoard(),
      checklist: createAnalyticsPlannerShiftChecklist(),
      incidents: createAnalyticsPlannerIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsPlannerReportCards(),
      packets: createAnalyticsPlannerReviewPackets(),
      summary: summarizeAnalyticsPlannerReporting()
    },
    audit: {
      trail: createAnalyticsPlannerAuditTrail(),
      manifest: createAnalyticsPlannerEvidenceManifest(),
      attestation: createAnalyticsPlannerReadinessAttestation()
    },
    playbooks: createAnalyticsPlannerPlaybooks(),
    decisions: createAnalyticsPlannerDecisionDeck(),
    escalationMoments: createAnalyticsPlannerEscalationMoments()
  };
}

export function createAnalyticsPlannerReadinessBoard(snapshot = buildAnalyticsPlannerSnapshot()) {
  return [
    { id: 'analytics-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsPlannerApiDocument(snapshot = buildAnalyticsPlannerSnapshot()) {
  return {
    id: 'analytics-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-planner/overview' },
      { method: 'GET', path: '/api/analytics-planner/reporting' },
      { method: 'POST', path: '/api/analytics-planner/validate' },
      { method: 'GET', path: '/api/analytics-planner/audit' }
    ],
    readiness: createAnalyticsPlannerReadinessBoard(snapshot)
  };
}

export function createAnalyticsPlannerRouteSummary(snapshot = buildAnalyticsPlannerSnapshot()) {
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

