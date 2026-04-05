import { createLifecyclePlannerWorkspace, summarizeLifecyclePlannerWorkspace, createLifecyclePlannerNarratives, createLifecyclePlannerCoverageGrid } from './domain-lifecycle-planner.mjs';
import { createLifecyclePlannerPolicies, validateLifecyclePlannerPolicies, summarizeLifecyclePlannerPolicies, createLifecyclePlannerEscalationDeck } from './policies-lifecycle-planner.mjs';
import { createLifecyclePlannerAnalyticsTimeline, createLifecyclePlannerForecastEnvelope, createLifecyclePlannerExceptionLedger, summarizeLifecyclePlannerAnalytics } from './analytics-lifecycle-planner.mjs';
import { createLifecyclePlannerOperationsBoard, createLifecyclePlannerShiftChecklist, createLifecyclePlannerIncidentDeck } from './operations-lifecycle-planner.mjs';
import { createLifecyclePlannerReportCards, createLifecyclePlannerReviewPackets, summarizeLifecyclePlannerReporting } from './reporting-lifecycle-planner.mjs';
import { createLifecyclePlannerAuditTrail, createLifecyclePlannerEvidenceManifest, createLifecyclePlannerReadinessAttestation } from './audit-lifecycle-planner.mjs';
import { createLifecyclePlannerPlaybooks, createLifecyclePlannerDecisionDeck, createLifecyclePlannerEscalationMoments } from './playbooks-lifecycle-planner.mjs';

export function buildLifecyclePlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecyclePlannerWorkspace(workspaceName);
  const policies = createLifecyclePlannerPolicies();
  return {
    workspace,
    summary: summarizeLifecyclePlannerWorkspace(workspace),
    narratives: createLifecyclePlannerNarratives(workspace),
    coverage: createLifecyclePlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecyclePlannerPolicies(policies),
    validation: validateLifecyclePlannerPolicies(policies),
    escalationDeck: createLifecyclePlannerEscalationDeck(policies),
    analytics: {
      timeline: createLifecyclePlannerAnalyticsTimeline(),
      forecast: createLifecyclePlannerForecastEnvelope(),
      exceptions: createLifecyclePlannerExceptionLedger(),
      summary: summarizeLifecyclePlannerAnalytics()
    },
    operations: {
      board: createLifecyclePlannerOperationsBoard(),
      checklist: createLifecyclePlannerShiftChecklist(),
      incidents: createLifecyclePlannerIncidentDeck()
    },
    reporting: {
      cards: createLifecyclePlannerReportCards(),
      packets: createLifecyclePlannerReviewPackets(),
      summary: summarizeLifecyclePlannerReporting()
    },
    audit: {
      trail: createLifecyclePlannerAuditTrail(),
      manifest: createLifecyclePlannerEvidenceManifest(),
      attestation: createLifecyclePlannerReadinessAttestation()
    },
    playbooks: createLifecyclePlannerPlaybooks(),
    decisions: createLifecyclePlannerDecisionDeck(),
    escalationMoments: createLifecyclePlannerEscalationMoments()
  };
}

export function createLifecyclePlannerReadinessBoard(snapshot = buildLifecyclePlannerSnapshot()) {
  return [
    { id: 'lifecycle-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecyclePlannerApiDocument(snapshot = buildLifecyclePlannerSnapshot()) {
  return {
    id: 'lifecycle-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-planner/overview' },
      { method: 'GET', path: '/api/lifecycle-planner/reporting' },
      { method: 'POST', path: '/api/lifecycle-planner/validate' },
      { method: 'GET', path: '/api/lifecycle-planner/audit' }
    ],
    readiness: createLifecyclePlannerReadinessBoard(snapshot)
  };
}

export function createLifecyclePlannerRouteSummary(snapshot = buildLifecyclePlannerSnapshot()) {
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

