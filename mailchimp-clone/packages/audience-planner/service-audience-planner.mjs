import { createAudiencePlannerWorkspace, summarizeAudiencePlannerWorkspace, createAudiencePlannerNarratives, createAudiencePlannerCoverageGrid } from './domain-audience-planner.mjs';
import { createAudiencePlannerPolicies, validateAudiencePlannerPolicies, summarizeAudiencePlannerPolicies, createAudiencePlannerEscalationDeck } from './policies-audience-planner.mjs';
import { createAudiencePlannerAnalyticsTimeline, createAudiencePlannerForecastEnvelope, createAudiencePlannerExceptionLedger, summarizeAudiencePlannerAnalytics } from './analytics-audience-planner.mjs';
import { createAudiencePlannerOperationsBoard, createAudiencePlannerShiftChecklist, createAudiencePlannerIncidentDeck } from './operations-audience-planner.mjs';
import { createAudiencePlannerReportCards, createAudiencePlannerReviewPackets, summarizeAudiencePlannerReporting } from './reporting-audience-planner.mjs';
import { createAudiencePlannerAuditTrail, createAudiencePlannerEvidenceManifest, createAudiencePlannerReadinessAttestation } from './audit-audience-planner.mjs';
import { createAudiencePlannerPlaybooks, createAudiencePlannerDecisionDeck, createAudiencePlannerEscalationMoments } from './playbooks-audience-planner.mjs';

export function buildAudiencePlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudiencePlannerWorkspace(workspaceName);
  const policies = createAudiencePlannerPolicies();
  return {
    workspace,
    summary: summarizeAudiencePlannerWorkspace(workspace),
    narratives: createAudiencePlannerNarratives(workspace),
    coverage: createAudiencePlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudiencePlannerPolicies(policies),
    validation: validateAudiencePlannerPolicies(policies),
    escalationDeck: createAudiencePlannerEscalationDeck(policies),
    analytics: {
      timeline: createAudiencePlannerAnalyticsTimeline(),
      forecast: createAudiencePlannerForecastEnvelope(),
      exceptions: createAudiencePlannerExceptionLedger(),
      summary: summarizeAudiencePlannerAnalytics()
    },
    operations: {
      board: createAudiencePlannerOperationsBoard(),
      checklist: createAudiencePlannerShiftChecklist(),
      incidents: createAudiencePlannerIncidentDeck()
    },
    reporting: {
      cards: createAudiencePlannerReportCards(),
      packets: createAudiencePlannerReviewPackets(),
      summary: summarizeAudiencePlannerReporting()
    },
    audit: {
      trail: createAudiencePlannerAuditTrail(),
      manifest: createAudiencePlannerEvidenceManifest(),
      attestation: createAudiencePlannerReadinessAttestation()
    },
    playbooks: createAudiencePlannerPlaybooks(),
    decisions: createAudiencePlannerDecisionDeck(),
    escalationMoments: createAudiencePlannerEscalationMoments()
  };
}

export function createAudiencePlannerReadinessBoard(snapshot = buildAudiencePlannerSnapshot()) {
  return [
    { id: 'audience-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudiencePlannerApiDocument(snapshot = buildAudiencePlannerSnapshot()) {
  return {
    id: 'audience-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-planner/overview' },
      { method: 'GET', path: '/api/audience-planner/reporting' },
      { method: 'POST', path: '/api/audience-planner/validate' },
      { method: 'GET', path: '/api/audience-planner/audit' }
    ],
    readiness: createAudiencePlannerReadinessBoard(snapshot)
  };
}

export function createAudiencePlannerRouteSummary(snapshot = buildAudiencePlannerSnapshot()) {
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

