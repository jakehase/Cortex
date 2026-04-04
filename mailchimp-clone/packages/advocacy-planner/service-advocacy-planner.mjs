import { createAdvocacyPlannerWorkspace, summarizeAdvocacyPlannerWorkspace, createAdvocacyPlannerNarratives, createAdvocacyPlannerCoverageGrid } from './domain-advocacy-planner.mjs';
import { createAdvocacyPlannerPolicies, validateAdvocacyPlannerPolicies, summarizeAdvocacyPlannerPolicies, createAdvocacyPlannerEscalationDeck } from './policies-advocacy-planner.mjs';
import { createAdvocacyPlannerAnalyticsTimeline, createAdvocacyPlannerForecastEnvelope, createAdvocacyPlannerExceptionLedger, summarizeAdvocacyPlannerAnalytics } from './analytics-advocacy-planner.mjs';
import { createAdvocacyPlannerOperationsBoard, createAdvocacyPlannerShiftChecklist, createAdvocacyPlannerIncidentDeck } from './operations-advocacy-planner.mjs';
import { createAdvocacyPlannerReportCards, createAdvocacyPlannerReviewPackets, summarizeAdvocacyPlannerReporting } from './reporting-advocacy-planner.mjs';
import { createAdvocacyPlannerAuditTrail, createAdvocacyPlannerEvidenceManifest, createAdvocacyPlannerReadinessAttestation } from './audit-advocacy-planner.mjs';
import { createAdvocacyPlannerPlaybooks, createAdvocacyPlannerDecisionDeck, createAdvocacyPlannerEscalationMoments } from './playbooks-advocacy-planner.mjs';

export function buildAdvocacyPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyPlannerWorkspace(workspaceName);
  const policies = createAdvocacyPlannerPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyPlannerWorkspace(workspace),
    narratives: createAdvocacyPlannerNarratives(workspace),
    coverage: createAdvocacyPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyPlannerPolicies(policies),
    validation: validateAdvocacyPlannerPolicies(policies),
    escalationDeck: createAdvocacyPlannerEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyPlannerAnalyticsTimeline(),
      forecast: createAdvocacyPlannerForecastEnvelope(),
      exceptions: createAdvocacyPlannerExceptionLedger(),
      summary: summarizeAdvocacyPlannerAnalytics()
    },
    operations: {
      board: createAdvocacyPlannerOperationsBoard(),
      checklist: createAdvocacyPlannerShiftChecklist(),
      incidents: createAdvocacyPlannerIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyPlannerReportCards(),
      packets: createAdvocacyPlannerReviewPackets(),
      summary: summarizeAdvocacyPlannerReporting()
    },
    audit: {
      trail: createAdvocacyPlannerAuditTrail(),
      manifest: createAdvocacyPlannerEvidenceManifest(),
      attestation: createAdvocacyPlannerReadinessAttestation()
    },
    playbooks: createAdvocacyPlannerPlaybooks(),
    decisions: createAdvocacyPlannerDecisionDeck(),
    escalationMoments: createAdvocacyPlannerEscalationMoments()
  };
}

export function createAdvocacyPlannerReadinessBoard(snapshot = buildAdvocacyPlannerSnapshot()) {
  return [
    { id: 'advocacy-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyPlannerApiDocument(snapshot = buildAdvocacyPlannerSnapshot()) {
  return {
    id: 'advocacy-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-planner/overview' },
      { method: 'GET', path: '/api/advocacy-planner/reporting' },
      { method: 'POST', path: '/api/advocacy-planner/validate' },
      { method: 'GET', path: '/api/advocacy-planner/audit' }
    ],
    readiness: createAdvocacyPlannerReadinessBoard(snapshot)
  };
}

export function createAdvocacyPlannerRouteSummary(snapshot = buildAdvocacyPlannerSnapshot()) {
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

