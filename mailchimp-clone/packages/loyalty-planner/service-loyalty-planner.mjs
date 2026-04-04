import { createLoyaltyPlannerWorkspace, summarizeLoyaltyPlannerWorkspace, createLoyaltyPlannerNarratives, createLoyaltyPlannerCoverageGrid } from './domain-loyalty-planner.mjs';
import { createLoyaltyPlannerPolicies, validateLoyaltyPlannerPolicies, summarizeLoyaltyPlannerPolicies, createLoyaltyPlannerEscalationDeck } from './policies-loyalty-planner.mjs';
import { createLoyaltyPlannerAnalyticsTimeline, createLoyaltyPlannerForecastEnvelope, createLoyaltyPlannerExceptionLedger, summarizeLoyaltyPlannerAnalytics } from './analytics-loyalty-planner.mjs';
import { createLoyaltyPlannerOperationsBoard, createLoyaltyPlannerShiftChecklist, createLoyaltyPlannerIncidentDeck } from './operations-loyalty-planner.mjs';
import { createLoyaltyPlannerReportCards, createLoyaltyPlannerReviewPackets, summarizeLoyaltyPlannerReporting } from './reporting-loyalty-planner.mjs';
import { createLoyaltyPlannerAuditTrail, createLoyaltyPlannerEvidenceManifest, createLoyaltyPlannerReadinessAttestation } from './audit-loyalty-planner.mjs';
import { createLoyaltyPlannerPlaybooks, createLoyaltyPlannerDecisionDeck, createLoyaltyPlannerEscalationMoments } from './playbooks-loyalty-planner.mjs';

export function buildLoyaltyPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyPlannerWorkspace(workspaceName);
  const policies = createLoyaltyPlannerPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyPlannerWorkspace(workspace),
    narratives: createLoyaltyPlannerNarratives(workspace),
    coverage: createLoyaltyPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyPlannerPolicies(policies),
    validation: validateLoyaltyPlannerPolicies(policies),
    escalationDeck: createLoyaltyPlannerEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyPlannerAnalyticsTimeline(),
      forecast: createLoyaltyPlannerForecastEnvelope(),
      exceptions: createLoyaltyPlannerExceptionLedger(),
      summary: summarizeLoyaltyPlannerAnalytics()
    },
    operations: {
      board: createLoyaltyPlannerOperationsBoard(),
      checklist: createLoyaltyPlannerShiftChecklist(),
      incidents: createLoyaltyPlannerIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyPlannerReportCards(),
      packets: createLoyaltyPlannerReviewPackets(),
      summary: summarizeLoyaltyPlannerReporting()
    },
    audit: {
      trail: createLoyaltyPlannerAuditTrail(),
      manifest: createLoyaltyPlannerEvidenceManifest(),
      attestation: createLoyaltyPlannerReadinessAttestation()
    },
    playbooks: createLoyaltyPlannerPlaybooks(),
    decisions: createLoyaltyPlannerDecisionDeck(),
    escalationMoments: createLoyaltyPlannerEscalationMoments()
  };
}

export function createLoyaltyPlannerReadinessBoard(snapshot = buildLoyaltyPlannerSnapshot()) {
  return [
    { id: 'loyalty-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyPlannerApiDocument(snapshot = buildLoyaltyPlannerSnapshot()) {
  return {
    id: 'loyalty-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-planner/overview' },
      { method: 'GET', path: '/api/loyalty-planner/reporting' },
      { method: 'POST', path: '/api/loyalty-planner/validate' },
      { method: 'GET', path: '/api/loyalty-planner/audit' }
    ],
    readiness: createLoyaltyPlannerReadinessBoard(snapshot)
  };
}

export function createLoyaltyPlannerRouteSummary(snapshot = buildLoyaltyPlannerSnapshot()) {
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

