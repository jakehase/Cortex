import { createInsightsPlannerWorkspace, summarizeInsightsPlannerWorkspace, createInsightsPlannerNarratives, createInsightsPlannerCoverageGrid } from './domain-insights-planner.mjs';
import { createInsightsPlannerPolicies, validateInsightsPlannerPolicies, summarizeInsightsPlannerPolicies, createInsightsPlannerEscalationDeck } from './policies-insights-planner.mjs';
import { createInsightsPlannerAnalyticsTimeline, createInsightsPlannerForecastEnvelope, createInsightsPlannerExceptionLedger, summarizeInsightsPlannerAnalytics } from './analytics-insights-planner.mjs';
import { createInsightsPlannerOperationsBoard, createInsightsPlannerShiftChecklist, createInsightsPlannerIncidentDeck } from './operations-insights-planner.mjs';
import { createInsightsPlannerReportCards, createInsightsPlannerReviewPackets, summarizeInsightsPlannerReporting } from './reporting-insights-planner.mjs';
import { createInsightsPlannerAuditTrail, createInsightsPlannerEvidenceManifest, createInsightsPlannerReadinessAttestation } from './audit-insights-planner.mjs';
import { createInsightsPlannerPlaybooks, createInsightsPlannerDecisionDeck, createInsightsPlannerEscalationMoments } from './playbooks-insights-planner.mjs';

export function buildInsightsPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsPlannerWorkspace(workspaceName);
  const policies = createInsightsPlannerPolicies();
  return {
    workspace,
    summary: summarizeInsightsPlannerWorkspace(workspace),
    narratives: createInsightsPlannerNarratives(workspace),
    coverage: createInsightsPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsPlannerPolicies(policies),
    validation: validateInsightsPlannerPolicies(policies),
    escalationDeck: createInsightsPlannerEscalationDeck(policies),
    analytics: {
      timeline: createInsightsPlannerAnalyticsTimeline(),
      forecast: createInsightsPlannerForecastEnvelope(),
      exceptions: createInsightsPlannerExceptionLedger(),
      summary: summarizeInsightsPlannerAnalytics()
    },
    operations: {
      board: createInsightsPlannerOperationsBoard(),
      checklist: createInsightsPlannerShiftChecklist(),
      incidents: createInsightsPlannerIncidentDeck()
    },
    reporting: {
      cards: createInsightsPlannerReportCards(),
      packets: createInsightsPlannerReviewPackets(),
      summary: summarizeInsightsPlannerReporting()
    },
    audit: {
      trail: createInsightsPlannerAuditTrail(),
      manifest: createInsightsPlannerEvidenceManifest(),
      attestation: createInsightsPlannerReadinessAttestation()
    },
    playbooks: createInsightsPlannerPlaybooks(),
    decisions: createInsightsPlannerDecisionDeck(),
    escalationMoments: createInsightsPlannerEscalationMoments()
  };
}

export function createInsightsPlannerReadinessBoard(snapshot = buildInsightsPlannerSnapshot()) {
  return [
    { id: 'insights-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsPlannerApiDocument(snapshot = buildInsightsPlannerSnapshot()) {
  return {
    id: 'insights-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-planner/overview' },
      { method: 'GET', path: '/api/insights-planner/reporting' },
      { method: 'POST', path: '/api/insights-planner/validate' },
      { method: 'GET', path: '/api/insights-planner/audit' }
    ],
    readiness: createInsightsPlannerReadinessBoard(snapshot)
  };
}

export function createInsightsPlannerRouteSummary(snapshot = buildInsightsPlannerSnapshot()) {
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

