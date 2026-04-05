import { createDeliverabilityPlannerWorkspace, summarizeDeliverabilityPlannerWorkspace, createDeliverabilityPlannerNarratives, createDeliverabilityPlannerCoverageGrid } from './domain-deliverability-planner.mjs';
import { createDeliverabilityPlannerPolicies, validateDeliverabilityPlannerPolicies, summarizeDeliverabilityPlannerPolicies, createDeliverabilityPlannerEscalationDeck } from './policies-deliverability-planner.mjs';
import { createDeliverabilityPlannerAnalyticsTimeline, createDeliverabilityPlannerForecastEnvelope, createDeliverabilityPlannerExceptionLedger, summarizeDeliverabilityPlannerAnalytics } from './analytics-deliverability-planner.mjs';
import { createDeliverabilityPlannerOperationsBoard, createDeliverabilityPlannerShiftChecklist, createDeliverabilityPlannerIncidentDeck } from './operations-deliverability-planner.mjs';
import { createDeliverabilityPlannerReportCards, createDeliverabilityPlannerReviewPackets, summarizeDeliverabilityPlannerReporting } from './reporting-deliverability-planner.mjs';
import { createDeliverabilityPlannerAuditTrail, createDeliverabilityPlannerEvidenceManifest, createDeliverabilityPlannerReadinessAttestation } from './audit-deliverability-planner.mjs';
import { createDeliverabilityPlannerPlaybooks, createDeliverabilityPlannerDecisionDeck, createDeliverabilityPlannerEscalationMoments } from './playbooks-deliverability-planner.mjs';

export function buildDeliverabilityPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityPlannerWorkspace(workspaceName);
  const policies = createDeliverabilityPlannerPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityPlannerWorkspace(workspace),
    narratives: createDeliverabilityPlannerNarratives(workspace),
    coverage: createDeliverabilityPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityPlannerPolicies(policies),
    validation: validateDeliverabilityPlannerPolicies(policies),
    escalationDeck: createDeliverabilityPlannerEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityPlannerAnalyticsTimeline(),
      forecast: createDeliverabilityPlannerForecastEnvelope(),
      exceptions: createDeliverabilityPlannerExceptionLedger(),
      summary: summarizeDeliverabilityPlannerAnalytics()
    },
    operations: {
      board: createDeliverabilityPlannerOperationsBoard(),
      checklist: createDeliverabilityPlannerShiftChecklist(),
      incidents: createDeliverabilityPlannerIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityPlannerReportCards(),
      packets: createDeliverabilityPlannerReviewPackets(),
      summary: summarizeDeliverabilityPlannerReporting()
    },
    audit: {
      trail: createDeliverabilityPlannerAuditTrail(),
      manifest: createDeliverabilityPlannerEvidenceManifest(),
      attestation: createDeliverabilityPlannerReadinessAttestation()
    },
    playbooks: createDeliverabilityPlannerPlaybooks(),
    decisions: createDeliverabilityPlannerDecisionDeck(),
    escalationMoments: createDeliverabilityPlannerEscalationMoments()
  };
}

export function createDeliverabilityPlannerReadinessBoard(snapshot = buildDeliverabilityPlannerSnapshot()) {
  return [
    { id: 'deliverability-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityPlannerApiDocument(snapshot = buildDeliverabilityPlannerSnapshot()) {
  return {
    id: 'deliverability-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-planner/overview' },
      { method: 'GET', path: '/api/deliverability-planner/reporting' },
      { method: 'POST', path: '/api/deliverability-planner/validate' },
      { method: 'GET', path: '/api/deliverability-planner/audit' }
    ],
    readiness: createDeliverabilityPlannerReadinessBoard(snapshot)
  };
}

export function createDeliverabilityPlannerRouteSummary(snapshot = buildDeliverabilityPlannerSnapshot()) {
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

