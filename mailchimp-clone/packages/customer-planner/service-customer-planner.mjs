import { createCustomerPlannerWorkspace, summarizeCustomerPlannerWorkspace, createCustomerPlannerNarratives, createCustomerPlannerCoverageGrid } from './domain-customer-planner.mjs';
import { createCustomerPlannerPolicies, validateCustomerPlannerPolicies, summarizeCustomerPlannerPolicies, createCustomerPlannerEscalationDeck } from './policies-customer-planner.mjs';
import { createCustomerPlannerAnalyticsTimeline, createCustomerPlannerForecastEnvelope, createCustomerPlannerExceptionLedger, summarizeCustomerPlannerAnalytics } from './analytics-customer-planner.mjs';
import { createCustomerPlannerOperationsBoard, createCustomerPlannerShiftChecklist, createCustomerPlannerIncidentDeck } from './operations-customer-planner.mjs';
import { createCustomerPlannerReportCards, createCustomerPlannerReviewPackets, summarizeCustomerPlannerReporting } from './reporting-customer-planner.mjs';
import { createCustomerPlannerAuditTrail, createCustomerPlannerEvidenceManifest, createCustomerPlannerReadinessAttestation } from './audit-customer-planner.mjs';
import { createCustomerPlannerPlaybooks, createCustomerPlannerDecisionDeck, createCustomerPlannerEscalationMoments } from './playbooks-customer-planner.mjs';

export function buildCustomerPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerPlannerWorkspace(workspaceName);
  const policies = createCustomerPlannerPolicies();
  return {
    workspace,
    summary: summarizeCustomerPlannerWorkspace(workspace),
    narratives: createCustomerPlannerNarratives(workspace),
    coverage: createCustomerPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerPlannerPolicies(policies),
    validation: validateCustomerPlannerPolicies(policies),
    escalationDeck: createCustomerPlannerEscalationDeck(policies),
    analytics: {
      timeline: createCustomerPlannerAnalyticsTimeline(),
      forecast: createCustomerPlannerForecastEnvelope(),
      exceptions: createCustomerPlannerExceptionLedger(),
      summary: summarizeCustomerPlannerAnalytics()
    },
    operations: {
      board: createCustomerPlannerOperationsBoard(),
      checklist: createCustomerPlannerShiftChecklist(),
      incidents: createCustomerPlannerIncidentDeck()
    },
    reporting: {
      cards: createCustomerPlannerReportCards(),
      packets: createCustomerPlannerReviewPackets(),
      summary: summarizeCustomerPlannerReporting()
    },
    audit: {
      trail: createCustomerPlannerAuditTrail(),
      manifest: createCustomerPlannerEvidenceManifest(),
      attestation: createCustomerPlannerReadinessAttestation()
    },
    playbooks: createCustomerPlannerPlaybooks(),
    decisions: createCustomerPlannerDecisionDeck(),
    escalationMoments: createCustomerPlannerEscalationMoments()
  };
}

export function createCustomerPlannerReadinessBoard(snapshot = buildCustomerPlannerSnapshot()) {
  return [
    { id: 'customer-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerPlannerApiDocument(snapshot = buildCustomerPlannerSnapshot()) {
  return {
    id: 'customer-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-planner/overview' },
      { method: 'GET', path: '/api/customer-planner/reporting' },
      { method: 'POST', path: '/api/customer-planner/validate' },
      { method: 'GET', path: '/api/customer-planner/audit' }
    ],
    readiness: createCustomerPlannerReadinessBoard(snapshot)
  };
}

export function createCustomerPlannerRouteSummary(snapshot = buildCustomerPlannerSnapshot()) {
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

