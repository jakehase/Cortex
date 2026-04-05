import { createCollaborationPlannerWorkspace, summarizeCollaborationPlannerWorkspace, createCollaborationPlannerNarratives, createCollaborationPlannerCoverageGrid } from './domain-collaboration-planner.mjs';
import { createCollaborationPlannerPolicies, validateCollaborationPlannerPolicies, summarizeCollaborationPlannerPolicies, createCollaborationPlannerEscalationDeck } from './policies-collaboration-planner.mjs';
import { createCollaborationPlannerAnalyticsTimeline, createCollaborationPlannerForecastEnvelope, createCollaborationPlannerExceptionLedger, summarizeCollaborationPlannerAnalytics } from './analytics-collaboration-planner.mjs';
import { createCollaborationPlannerOperationsBoard, createCollaborationPlannerShiftChecklist, createCollaborationPlannerIncidentDeck } from './operations-collaboration-planner.mjs';
import { createCollaborationPlannerReportCards, createCollaborationPlannerReviewPackets, summarizeCollaborationPlannerReporting } from './reporting-collaboration-planner.mjs';
import { createCollaborationPlannerAuditTrail, createCollaborationPlannerEvidenceManifest, createCollaborationPlannerReadinessAttestation } from './audit-collaboration-planner.mjs';
import { createCollaborationPlannerPlaybooks, createCollaborationPlannerDecisionDeck, createCollaborationPlannerEscalationMoments } from './playbooks-collaboration-planner.mjs';

export function buildCollaborationPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationPlannerWorkspace(workspaceName);
  const policies = createCollaborationPlannerPolicies();
  return {
    workspace,
    summary: summarizeCollaborationPlannerWorkspace(workspace),
    narratives: createCollaborationPlannerNarratives(workspace),
    coverage: createCollaborationPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationPlannerPolicies(policies),
    validation: validateCollaborationPlannerPolicies(policies),
    escalationDeck: createCollaborationPlannerEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationPlannerAnalyticsTimeline(),
      forecast: createCollaborationPlannerForecastEnvelope(),
      exceptions: createCollaborationPlannerExceptionLedger(),
      summary: summarizeCollaborationPlannerAnalytics()
    },
    operations: {
      board: createCollaborationPlannerOperationsBoard(),
      checklist: createCollaborationPlannerShiftChecklist(),
      incidents: createCollaborationPlannerIncidentDeck()
    },
    reporting: {
      cards: createCollaborationPlannerReportCards(),
      packets: createCollaborationPlannerReviewPackets(),
      summary: summarizeCollaborationPlannerReporting()
    },
    audit: {
      trail: createCollaborationPlannerAuditTrail(),
      manifest: createCollaborationPlannerEvidenceManifest(),
      attestation: createCollaborationPlannerReadinessAttestation()
    },
    playbooks: createCollaborationPlannerPlaybooks(),
    decisions: createCollaborationPlannerDecisionDeck(),
    escalationMoments: createCollaborationPlannerEscalationMoments()
  };
}

export function createCollaborationPlannerReadinessBoard(snapshot = buildCollaborationPlannerSnapshot()) {
  return [
    { id: 'collaboration-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationPlannerApiDocument(snapshot = buildCollaborationPlannerSnapshot()) {
  return {
    id: 'collaboration-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-planner/overview' },
      { method: 'GET', path: '/api/collaboration-planner/reporting' },
      { method: 'POST', path: '/api/collaboration-planner/validate' },
      { method: 'GET', path: '/api/collaboration-planner/audit' }
    ],
    readiness: createCollaborationPlannerReadinessBoard(snapshot)
  };
}

export function createCollaborationPlannerRouteSummary(snapshot = buildCollaborationPlannerSnapshot()) {
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

