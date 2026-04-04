import { createAutomationPlannerWorkspace, summarizeAutomationPlannerWorkspace, createAutomationPlannerNarratives, createAutomationPlannerCoverageGrid } from './domain-automation-planner.mjs';
import { createAutomationPlannerPolicies, validateAutomationPlannerPolicies, summarizeAutomationPlannerPolicies, createAutomationPlannerEscalationDeck } from './policies-automation-planner.mjs';
import { createAutomationPlannerAnalyticsTimeline, createAutomationPlannerForecastEnvelope, createAutomationPlannerExceptionLedger, summarizeAutomationPlannerAnalytics } from './analytics-automation-planner.mjs';
import { createAutomationPlannerOperationsBoard, createAutomationPlannerShiftChecklist, createAutomationPlannerIncidentDeck } from './operations-automation-planner.mjs';
import { createAutomationPlannerReportCards, createAutomationPlannerReviewPackets, summarizeAutomationPlannerReporting } from './reporting-automation-planner.mjs';
import { createAutomationPlannerAuditTrail, createAutomationPlannerEvidenceManifest, createAutomationPlannerReadinessAttestation } from './audit-automation-planner.mjs';
import { createAutomationPlannerPlaybooks, createAutomationPlannerDecisionDeck, createAutomationPlannerEscalationMoments } from './playbooks-automation-planner.mjs';

export function buildAutomationPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationPlannerWorkspace(workspaceName);
  const policies = createAutomationPlannerPolicies();
  return {
    workspace,
    summary: summarizeAutomationPlannerWorkspace(workspace),
    narratives: createAutomationPlannerNarratives(workspace),
    coverage: createAutomationPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationPlannerPolicies(policies),
    validation: validateAutomationPlannerPolicies(policies),
    escalationDeck: createAutomationPlannerEscalationDeck(policies),
    analytics: {
      timeline: createAutomationPlannerAnalyticsTimeline(),
      forecast: createAutomationPlannerForecastEnvelope(),
      exceptions: createAutomationPlannerExceptionLedger(),
      summary: summarizeAutomationPlannerAnalytics()
    },
    operations: {
      board: createAutomationPlannerOperationsBoard(),
      checklist: createAutomationPlannerShiftChecklist(),
      incidents: createAutomationPlannerIncidentDeck()
    },
    reporting: {
      cards: createAutomationPlannerReportCards(),
      packets: createAutomationPlannerReviewPackets(),
      summary: summarizeAutomationPlannerReporting()
    },
    audit: {
      trail: createAutomationPlannerAuditTrail(),
      manifest: createAutomationPlannerEvidenceManifest(),
      attestation: createAutomationPlannerReadinessAttestation()
    },
    playbooks: createAutomationPlannerPlaybooks(),
    decisions: createAutomationPlannerDecisionDeck(),
    escalationMoments: createAutomationPlannerEscalationMoments()
  };
}

export function createAutomationPlannerReadinessBoard(snapshot = buildAutomationPlannerSnapshot()) {
  return [
    { id: 'automation-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationPlannerApiDocument(snapshot = buildAutomationPlannerSnapshot()) {
  return {
    id: 'automation-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-planner/overview' },
      { method: 'GET', path: '/api/automation-planner/reporting' },
      { method: 'POST', path: '/api/automation-planner/validate' },
      { method: 'GET', path: '/api/automation-planner/audit' }
    ],
    readiness: createAutomationPlannerReadinessBoard(snapshot)
  };
}

export function createAutomationPlannerRouteSummary(snapshot = buildAutomationPlannerSnapshot()) {
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

