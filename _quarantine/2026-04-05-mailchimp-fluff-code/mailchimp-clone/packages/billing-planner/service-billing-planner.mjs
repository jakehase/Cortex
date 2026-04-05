import { createBillingPlannerWorkspace, summarizeBillingPlannerWorkspace, createBillingPlannerNarratives, createBillingPlannerCoverageGrid } from './domain-billing-planner.mjs';
import { createBillingPlannerPolicies, validateBillingPlannerPolicies, summarizeBillingPlannerPolicies, createBillingPlannerEscalationDeck } from './policies-billing-planner.mjs';
import { createBillingPlannerAnalyticsTimeline, createBillingPlannerForecastEnvelope, createBillingPlannerExceptionLedger, summarizeBillingPlannerAnalytics } from './analytics-billing-planner.mjs';
import { createBillingPlannerOperationsBoard, createBillingPlannerShiftChecklist, createBillingPlannerIncidentDeck } from './operations-billing-planner.mjs';
import { createBillingPlannerReportCards, createBillingPlannerReviewPackets, summarizeBillingPlannerReporting } from './reporting-billing-planner.mjs';
import { createBillingPlannerAuditTrail, createBillingPlannerEvidenceManifest, createBillingPlannerReadinessAttestation } from './audit-billing-planner.mjs';
import { createBillingPlannerPlaybooks, createBillingPlannerDecisionDeck, createBillingPlannerEscalationMoments } from './playbooks-billing-planner.mjs';

export function buildBillingPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingPlannerWorkspace(workspaceName);
  const policies = createBillingPlannerPolicies();
  return {
    workspace,
    summary: summarizeBillingPlannerWorkspace(workspace),
    narratives: createBillingPlannerNarratives(workspace),
    coverage: createBillingPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingPlannerPolicies(policies),
    validation: validateBillingPlannerPolicies(policies),
    escalationDeck: createBillingPlannerEscalationDeck(policies),
    analytics: {
      timeline: createBillingPlannerAnalyticsTimeline(),
      forecast: createBillingPlannerForecastEnvelope(),
      exceptions: createBillingPlannerExceptionLedger(),
      summary: summarizeBillingPlannerAnalytics()
    },
    operations: {
      board: createBillingPlannerOperationsBoard(),
      checklist: createBillingPlannerShiftChecklist(),
      incidents: createBillingPlannerIncidentDeck()
    },
    reporting: {
      cards: createBillingPlannerReportCards(),
      packets: createBillingPlannerReviewPackets(),
      summary: summarizeBillingPlannerReporting()
    },
    audit: {
      trail: createBillingPlannerAuditTrail(),
      manifest: createBillingPlannerEvidenceManifest(),
      attestation: createBillingPlannerReadinessAttestation()
    },
    playbooks: createBillingPlannerPlaybooks(),
    decisions: createBillingPlannerDecisionDeck(),
    escalationMoments: createBillingPlannerEscalationMoments()
  };
}

export function createBillingPlannerReadinessBoard(snapshot = buildBillingPlannerSnapshot()) {
  return [
    { id: 'billing-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingPlannerApiDocument(snapshot = buildBillingPlannerSnapshot()) {
  return {
    id: 'billing-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-planner/overview' },
      { method: 'GET', path: '/api/billing-planner/reporting' },
      { method: 'POST', path: '/api/billing-planner/validate' },
      { method: 'GET', path: '/api/billing-planner/audit' }
    ],
    readiness: createBillingPlannerReadinessBoard(snapshot)
  };
}

export function createBillingPlannerRouteSummary(snapshot = buildBillingPlannerSnapshot()) {
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

