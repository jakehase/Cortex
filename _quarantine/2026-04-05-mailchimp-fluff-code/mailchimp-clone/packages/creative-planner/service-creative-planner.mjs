import { createCreativePlannerWorkspace, summarizeCreativePlannerWorkspace, createCreativePlannerNarratives, createCreativePlannerCoverageGrid } from './domain-creative-planner.mjs';
import { createCreativePlannerPolicies, validateCreativePlannerPolicies, summarizeCreativePlannerPolicies, createCreativePlannerEscalationDeck } from './policies-creative-planner.mjs';
import { createCreativePlannerAnalyticsTimeline, createCreativePlannerForecastEnvelope, createCreativePlannerExceptionLedger, summarizeCreativePlannerAnalytics } from './analytics-creative-planner.mjs';
import { createCreativePlannerOperationsBoard, createCreativePlannerShiftChecklist, createCreativePlannerIncidentDeck } from './operations-creative-planner.mjs';
import { createCreativePlannerReportCards, createCreativePlannerReviewPackets, summarizeCreativePlannerReporting } from './reporting-creative-planner.mjs';
import { createCreativePlannerAuditTrail, createCreativePlannerEvidenceManifest, createCreativePlannerReadinessAttestation } from './audit-creative-planner.mjs';
import { createCreativePlannerPlaybooks, createCreativePlannerDecisionDeck, createCreativePlannerEscalationMoments } from './playbooks-creative-planner.mjs';

export function buildCreativePlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativePlannerWorkspace(workspaceName);
  const policies = createCreativePlannerPolicies();
  return {
    workspace,
    summary: summarizeCreativePlannerWorkspace(workspace),
    narratives: createCreativePlannerNarratives(workspace),
    coverage: createCreativePlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativePlannerPolicies(policies),
    validation: validateCreativePlannerPolicies(policies),
    escalationDeck: createCreativePlannerEscalationDeck(policies),
    analytics: {
      timeline: createCreativePlannerAnalyticsTimeline(),
      forecast: createCreativePlannerForecastEnvelope(),
      exceptions: createCreativePlannerExceptionLedger(),
      summary: summarizeCreativePlannerAnalytics()
    },
    operations: {
      board: createCreativePlannerOperationsBoard(),
      checklist: createCreativePlannerShiftChecklist(),
      incidents: createCreativePlannerIncidentDeck()
    },
    reporting: {
      cards: createCreativePlannerReportCards(),
      packets: createCreativePlannerReviewPackets(),
      summary: summarizeCreativePlannerReporting()
    },
    audit: {
      trail: createCreativePlannerAuditTrail(),
      manifest: createCreativePlannerEvidenceManifest(),
      attestation: createCreativePlannerReadinessAttestation()
    },
    playbooks: createCreativePlannerPlaybooks(),
    decisions: createCreativePlannerDecisionDeck(),
    escalationMoments: createCreativePlannerEscalationMoments()
  };
}

export function createCreativePlannerReadinessBoard(snapshot = buildCreativePlannerSnapshot()) {
  return [
    { id: 'creative-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativePlannerApiDocument(snapshot = buildCreativePlannerSnapshot()) {
  return {
    id: 'creative-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-planner/overview' },
      { method: 'GET', path: '/api/creative-planner/reporting' },
      { method: 'POST', path: '/api/creative-planner/validate' },
      { method: 'GET', path: '/api/creative-planner/audit' }
    ],
    readiness: createCreativePlannerReadinessBoard(snapshot)
  };
}

export function createCreativePlannerRouteSummary(snapshot = buildCreativePlannerSnapshot()) {
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

