import { createContentPlannerWorkspace, summarizeContentPlannerWorkspace, createContentPlannerNarratives, createContentPlannerCoverageGrid } from './domain-content-planner.mjs';
import { createContentPlannerPolicies, validateContentPlannerPolicies, summarizeContentPlannerPolicies, createContentPlannerEscalationDeck } from './policies-content-planner.mjs';
import { createContentPlannerAnalyticsTimeline, createContentPlannerForecastEnvelope, createContentPlannerExceptionLedger, summarizeContentPlannerAnalytics } from './analytics-content-planner.mjs';
import { createContentPlannerOperationsBoard, createContentPlannerShiftChecklist, createContentPlannerIncidentDeck } from './operations-content-planner.mjs';
import { createContentPlannerReportCards, createContentPlannerReviewPackets, summarizeContentPlannerReporting } from './reporting-content-planner.mjs';
import { createContentPlannerAuditTrail, createContentPlannerEvidenceManifest, createContentPlannerReadinessAttestation } from './audit-content-planner.mjs';
import { createContentPlannerPlaybooks, createContentPlannerDecisionDeck, createContentPlannerEscalationMoments } from './playbooks-content-planner.mjs';

export function buildContentPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentPlannerWorkspace(workspaceName);
  const policies = createContentPlannerPolicies();
  return {
    workspace,
    summary: summarizeContentPlannerWorkspace(workspace),
    narratives: createContentPlannerNarratives(workspace),
    coverage: createContentPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentPlannerPolicies(policies),
    validation: validateContentPlannerPolicies(policies),
    escalationDeck: createContentPlannerEscalationDeck(policies),
    analytics: {
      timeline: createContentPlannerAnalyticsTimeline(),
      forecast: createContentPlannerForecastEnvelope(),
      exceptions: createContentPlannerExceptionLedger(),
      summary: summarizeContentPlannerAnalytics()
    },
    operations: {
      board: createContentPlannerOperationsBoard(),
      checklist: createContentPlannerShiftChecklist(),
      incidents: createContentPlannerIncidentDeck()
    },
    reporting: {
      cards: createContentPlannerReportCards(),
      packets: createContentPlannerReviewPackets(),
      summary: summarizeContentPlannerReporting()
    },
    audit: {
      trail: createContentPlannerAuditTrail(),
      manifest: createContentPlannerEvidenceManifest(),
      attestation: createContentPlannerReadinessAttestation()
    },
    playbooks: createContentPlannerPlaybooks(),
    decisions: createContentPlannerDecisionDeck(),
    escalationMoments: createContentPlannerEscalationMoments()
  };
}

export function createContentPlannerReadinessBoard(snapshot = buildContentPlannerSnapshot()) {
  return [
    { id: 'content-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentPlannerApiDocument(snapshot = buildContentPlannerSnapshot()) {
  return {
    id: 'content-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-planner/overview' },
      { method: 'GET', path: '/api/content-planner/reporting' },
      { method: 'POST', path: '/api/content-planner/validate' },
      { method: 'GET', path: '/api/content-planner/audit' }
    ],
    readiness: createContentPlannerReadinessBoard(snapshot)
  };
}

export function createContentPlannerRouteSummary(snapshot = buildContentPlannerSnapshot()) {
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

