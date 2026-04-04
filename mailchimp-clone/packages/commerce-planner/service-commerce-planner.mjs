import { createCommercePlannerWorkspace, summarizeCommercePlannerWorkspace, createCommercePlannerNarratives, createCommercePlannerCoverageGrid } from './domain-commerce-planner.mjs';
import { createCommercePlannerPolicies, validateCommercePlannerPolicies, summarizeCommercePlannerPolicies, createCommercePlannerEscalationDeck } from './policies-commerce-planner.mjs';
import { createCommercePlannerAnalyticsTimeline, createCommercePlannerForecastEnvelope, createCommercePlannerExceptionLedger, summarizeCommercePlannerAnalytics } from './analytics-commerce-planner.mjs';
import { createCommercePlannerOperationsBoard, createCommercePlannerShiftChecklist, createCommercePlannerIncidentDeck } from './operations-commerce-planner.mjs';
import { createCommercePlannerReportCards, createCommercePlannerReviewPackets, summarizeCommercePlannerReporting } from './reporting-commerce-planner.mjs';
import { createCommercePlannerAuditTrail, createCommercePlannerEvidenceManifest, createCommercePlannerReadinessAttestation } from './audit-commerce-planner.mjs';
import { createCommercePlannerPlaybooks, createCommercePlannerDecisionDeck, createCommercePlannerEscalationMoments } from './playbooks-commerce-planner.mjs';

export function buildCommercePlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommercePlannerWorkspace(workspaceName);
  const policies = createCommercePlannerPolicies();
  return {
    workspace,
    summary: summarizeCommercePlannerWorkspace(workspace),
    narratives: createCommercePlannerNarratives(workspace),
    coverage: createCommercePlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommercePlannerPolicies(policies),
    validation: validateCommercePlannerPolicies(policies),
    escalationDeck: createCommercePlannerEscalationDeck(policies),
    analytics: {
      timeline: createCommercePlannerAnalyticsTimeline(),
      forecast: createCommercePlannerForecastEnvelope(),
      exceptions: createCommercePlannerExceptionLedger(),
      summary: summarizeCommercePlannerAnalytics()
    },
    operations: {
      board: createCommercePlannerOperationsBoard(),
      checklist: createCommercePlannerShiftChecklist(),
      incidents: createCommercePlannerIncidentDeck()
    },
    reporting: {
      cards: createCommercePlannerReportCards(),
      packets: createCommercePlannerReviewPackets(),
      summary: summarizeCommercePlannerReporting()
    },
    audit: {
      trail: createCommercePlannerAuditTrail(),
      manifest: createCommercePlannerEvidenceManifest(),
      attestation: createCommercePlannerReadinessAttestation()
    },
    playbooks: createCommercePlannerPlaybooks(),
    decisions: createCommercePlannerDecisionDeck(),
    escalationMoments: createCommercePlannerEscalationMoments()
  };
}

export function createCommercePlannerReadinessBoard(snapshot = buildCommercePlannerSnapshot()) {
  return [
    { id: 'commerce-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommercePlannerApiDocument(snapshot = buildCommercePlannerSnapshot()) {
  return {
    id: 'commerce-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-planner/overview' },
      { method: 'GET', path: '/api/commerce-planner/reporting' },
      { method: 'POST', path: '/api/commerce-planner/validate' },
      { method: 'GET', path: '/api/commerce-planner/audit' }
    ],
    readiness: createCommercePlannerReadinessBoard(snapshot)
  };
}

export function createCommercePlannerRouteSummary(snapshot = buildCommercePlannerSnapshot()) {
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

