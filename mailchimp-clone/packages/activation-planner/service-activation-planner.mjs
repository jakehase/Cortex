import { createActivationPlannerWorkspace, summarizeActivationPlannerWorkspace, createActivationPlannerNarratives, createActivationPlannerCoverageGrid } from './domain-activation-planner.mjs';
import { createActivationPlannerPolicies, validateActivationPlannerPolicies, summarizeActivationPlannerPolicies, createActivationPlannerEscalationDeck } from './policies-activation-planner.mjs';
import { createActivationPlannerAnalyticsTimeline, createActivationPlannerForecastEnvelope, createActivationPlannerExceptionLedger, summarizeActivationPlannerAnalytics } from './analytics-activation-planner.mjs';
import { createActivationPlannerOperationsBoard, createActivationPlannerShiftChecklist, createActivationPlannerIncidentDeck } from './operations-activation-planner.mjs';
import { createActivationPlannerReportCards, createActivationPlannerReviewPackets, summarizeActivationPlannerReporting } from './reporting-activation-planner.mjs';
import { createActivationPlannerAuditTrail, createActivationPlannerEvidenceManifest, createActivationPlannerReadinessAttestation } from './audit-activation-planner.mjs';
import { createActivationPlannerPlaybooks, createActivationPlannerDecisionDeck, createActivationPlannerEscalationMoments } from './playbooks-activation-planner.mjs';

export function buildActivationPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationPlannerWorkspace(workspaceName);
  const policies = createActivationPlannerPolicies();
  return {
    workspace,
    summary: summarizeActivationPlannerWorkspace(workspace),
    narratives: createActivationPlannerNarratives(workspace),
    coverage: createActivationPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationPlannerPolicies(policies),
    validation: validateActivationPlannerPolicies(policies),
    escalationDeck: createActivationPlannerEscalationDeck(policies),
    analytics: {
      timeline: createActivationPlannerAnalyticsTimeline(),
      forecast: createActivationPlannerForecastEnvelope(),
      exceptions: createActivationPlannerExceptionLedger(),
      summary: summarizeActivationPlannerAnalytics()
    },
    operations: {
      board: createActivationPlannerOperationsBoard(),
      checklist: createActivationPlannerShiftChecklist(),
      incidents: createActivationPlannerIncidentDeck()
    },
    reporting: {
      cards: createActivationPlannerReportCards(),
      packets: createActivationPlannerReviewPackets(),
      summary: summarizeActivationPlannerReporting()
    },
    audit: {
      trail: createActivationPlannerAuditTrail(),
      manifest: createActivationPlannerEvidenceManifest(),
      attestation: createActivationPlannerReadinessAttestation()
    },
    playbooks: createActivationPlannerPlaybooks(),
    decisions: createActivationPlannerDecisionDeck(),
    escalationMoments: createActivationPlannerEscalationMoments()
  };
}

export function createActivationPlannerReadinessBoard(snapshot = buildActivationPlannerSnapshot()) {
  return [
    { id: 'activation-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationPlannerApiDocument(snapshot = buildActivationPlannerSnapshot()) {
  return {
    id: 'activation-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-planner/overview' },
      { method: 'GET', path: '/api/activation-planner/reporting' },
      { method: 'POST', path: '/api/activation-planner/validate' },
      { method: 'GET', path: '/api/activation-planner/audit' }
    ],
    readiness: createActivationPlannerReadinessBoard(snapshot)
  };
}

export function createActivationPlannerRouteSummary(snapshot = buildActivationPlannerSnapshot()) {
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

