import { createAcquisitionPlannerWorkspace, summarizeAcquisitionPlannerWorkspace, createAcquisitionPlannerNarratives, createAcquisitionPlannerCoverageGrid } from './domain-acquisition-planner.mjs';
import { createAcquisitionPlannerPolicies, validateAcquisitionPlannerPolicies, summarizeAcquisitionPlannerPolicies, createAcquisitionPlannerEscalationDeck } from './policies-acquisition-planner.mjs';
import { createAcquisitionPlannerAnalyticsTimeline, createAcquisitionPlannerForecastEnvelope, createAcquisitionPlannerExceptionLedger, summarizeAcquisitionPlannerAnalytics } from './analytics-acquisition-planner.mjs';
import { createAcquisitionPlannerOperationsBoard, createAcquisitionPlannerShiftChecklist, createAcquisitionPlannerIncidentDeck } from './operations-acquisition-planner.mjs';
import { createAcquisitionPlannerReportCards, createAcquisitionPlannerReviewPackets, summarizeAcquisitionPlannerReporting } from './reporting-acquisition-planner.mjs';
import { createAcquisitionPlannerAuditTrail, createAcquisitionPlannerEvidenceManifest, createAcquisitionPlannerReadinessAttestation } from './audit-acquisition-planner.mjs';
import { createAcquisitionPlannerPlaybooks, createAcquisitionPlannerDecisionDeck, createAcquisitionPlannerEscalationMoments } from './playbooks-acquisition-planner.mjs';

export function buildAcquisitionPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionPlannerWorkspace(workspaceName);
  const policies = createAcquisitionPlannerPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionPlannerWorkspace(workspace),
    narratives: createAcquisitionPlannerNarratives(workspace),
    coverage: createAcquisitionPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionPlannerPolicies(policies),
    validation: validateAcquisitionPlannerPolicies(policies),
    escalationDeck: createAcquisitionPlannerEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionPlannerAnalyticsTimeline(),
      forecast: createAcquisitionPlannerForecastEnvelope(),
      exceptions: createAcquisitionPlannerExceptionLedger(),
      summary: summarizeAcquisitionPlannerAnalytics()
    },
    operations: {
      board: createAcquisitionPlannerOperationsBoard(),
      checklist: createAcquisitionPlannerShiftChecklist(),
      incidents: createAcquisitionPlannerIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionPlannerReportCards(),
      packets: createAcquisitionPlannerReviewPackets(),
      summary: summarizeAcquisitionPlannerReporting()
    },
    audit: {
      trail: createAcquisitionPlannerAuditTrail(),
      manifest: createAcquisitionPlannerEvidenceManifest(),
      attestation: createAcquisitionPlannerReadinessAttestation()
    },
    playbooks: createAcquisitionPlannerPlaybooks(),
    decisions: createAcquisitionPlannerDecisionDeck(),
    escalationMoments: createAcquisitionPlannerEscalationMoments()
  };
}

export function createAcquisitionPlannerReadinessBoard(snapshot = buildAcquisitionPlannerSnapshot()) {
  return [
    { id: 'acquisition-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionPlannerApiDocument(snapshot = buildAcquisitionPlannerSnapshot()) {
  return {
    id: 'acquisition-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-planner/overview' },
      { method: 'GET', path: '/api/acquisition-planner/reporting' },
      { method: 'POST', path: '/api/acquisition-planner/validate' },
      { method: 'GET', path: '/api/acquisition-planner/audit' }
    ],
    readiness: createAcquisitionPlannerReadinessBoard(snapshot)
  };
}

export function createAcquisitionPlannerRouteSummary(snapshot = buildAcquisitionPlannerSnapshot()) {
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

