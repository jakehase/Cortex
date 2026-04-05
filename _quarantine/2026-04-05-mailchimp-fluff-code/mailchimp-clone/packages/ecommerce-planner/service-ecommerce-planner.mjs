import { createEcommercePlannerWorkspace, summarizeEcommercePlannerWorkspace, createEcommercePlannerNarratives, createEcommercePlannerCoverageGrid } from './domain-ecommerce-planner.mjs';
import { createEcommercePlannerPolicies, validateEcommercePlannerPolicies, summarizeEcommercePlannerPolicies, createEcommercePlannerEscalationDeck } from './policies-ecommerce-planner.mjs';
import { createEcommercePlannerAnalyticsTimeline, createEcommercePlannerForecastEnvelope, createEcommercePlannerExceptionLedger, summarizeEcommercePlannerAnalytics } from './analytics-ecommerce-planner.mjs';
import { createEcommercePlannerOperationsBoard, createEcommercePlannerShiftChecklist, createEcommercePlannerIncidentDeck } from './operations-ecommerce-planner.mjs';
import { createEcommercePlannerReportCards, createEcommercePlannerReviewPackets, summarizeEcommercePlannerReporting } from './reporting-ecommerce-planner.mjs';
import { createEcommercePlannerAuditTrail, createEcommercePlannerEvidenceManifest, createEcommercePlannerReadinessAttestation } from './audit-ecommerce-planner.mjs';
import { createEcommercePlannerPlaybooks, createEcommercePlannerDecisionDeck, createEcommercePlannerEscalationMoments } from './playbooks-ecommerce-planner.mjs';

export function buildEcommercePlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommercePlannerWorkspace(workspaceName);
  const policies = createEcommercePlannerPolicies();
  return {
    workspace,
    summary: summarizeEcommercePlannerWorkspace(workspace),
    narratives: createEcommercePlannerNarratives(workspace),
    coverage: createEcommercePlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommercePlannerPolicies(policies),
    validation: validateEcommercePlannerPolicies(policies),
    escalationDeck: createEcommercePlannerEscalationDeck(policies),
    analytics: {
      timeline: createEcommercePlannerAnalyticsTimeline(),
      forecast: createEcommercePlannerForecastEnvelope(),
      exceptions: createEcommercePlannerExceptionLedger(),
      summary: summarizeEcommercePlannerAnalytics()
    },
    operations: {
      board: createEcommercePlannerOperationsBoard(),
      checklist: createEcommercePlannerShiftChecklist(),
      incidents: createEcommercePlannerIncidentDeck()
    },
    reporting: {
      cards: createEcommercePlannerReportCards(),
      packets: createEcommercePlannerReviewPackets(),
      summary: summarizeEcommercePlannerReporting()
    },
    audit: {
      trail: createEcommercePlannerAuditTrail(),
      manifest: createEcommercePlannerEvidenceManifest(),
      attestation: createEcommercePlannerReadinessAttestation()
    },
    playbooks: createEcommercePlannerPlaybooks(),
    decisions: createEcommercePlannerDecisionDeck(),
    escalationMoments: createEcommercePlannerEscalationMoments()
  };
}

export function createEcommercePlannerReadinessBoard(snapshot = buildEcommercePlannerSnapshot()) {
  return [
    { id: 'ecommerce-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommercePlannerApiDocument(snapshot = buildEcommercePlannerSnapshot()) {
  return {
    id: 'ecommerce-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-planner/overview' },
      { method: 'GET', path: '/api/ecommerce-planner/reporting' },
      { method: 'POST', path: '/api/ecommerce-planner/validate' },
      { method: 'GET', path: '/api/ecommerce-planner/audit' }
    ],
    readiness: createEcommercePlannerReadinessBoard(snapshot)
  };
}

export function createEcommercePlannerRouteSummary(snapshot = buildEcommercePlannerSnapshot()) {
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

