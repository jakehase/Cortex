import { createCompliancePlannerWorkspace, summarizeCompliancePlannerWorkspace, createCompliancePlannerNarratives, createCompliancePlannerCoverageGrid } from './domain-compliance-planner.mjs';
import { createCompliancePlannerPolicies, validateCompliancePlannerPolicies, summarizeCompliancePlannerPolicies, createCompliancePlannerEscalationDeck } from './policies-compliance-planner.mjs';
import { createCompliancePlannerAnalyticsTimeline, createCompliancePlannerForecastEnvelope, createCompliancePlannerExceptionLedger, summarizeCompliancePlannerAnalytics } from './analytics-compliance-planner.mjs';
import { createCompliancePlannerOperationsBoard, createCompliancePlannerShiftChecklist, createCompliancePlannerIncidentDeck } from './operations-compliance-planner.mjs';
import { createCompliancePlannerReportCards, createCompliancePlannerReviewPackets, summarizeCompliancePlannerReporting } from './reporting-compliance-planner.mjs';
import { createCompliancePlannerAuditTrail, createCompliancePlannerEvidenceManifest, createCompliancePlannerReadinessAttestation } from './audit-compliance-planner.mjs';
import { createCompliancePlannerPlaybooks, createCompliancePlannerDecisionDeck, createCompliancePlannerEscalationMoments } from './playbooks-compliance-planner.mjs';

export function buildCompliancePlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCompliancePlannerWorkspace(workspaceName);
  const policies = createCompliancePlannerPolicies();
  return {
    workspace,
    summary: summarizeCompliancePlannerWorkspace(workspace),
    narratives: createCompliancePlannerNarratives(workspace),
    coverage: createCompliancePlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCompliancePlannerPolicies(policies),
    validation: validateCompliancePlannerPolicies(policies),
    escalationDeck: createCompliancePlannerEscalationDeck(policies),
    analytics: {
      timeline: createCompliancePlannerAnalyticsTimeline(),
      forecast: createCompliancePlannerForecastEnvelope(),
      exceptions: createCompliancePlannerExceptionLedger(),
      summary: summarizeCompliancePlannerAnalytics()
    },
    operations: {
      board: createCompliancePlannerOperationsBoard(),
      checklist: createCompliancePlannerShiftChecklist(),
      incidents: createCompliancePlannerIncidentDeck()
    },
    reporting: {
      cards: createCompliancePlannerReportCards(),
      packets: createCompliancePlannerReviewPackets(),
      summary: summarizeCompliancePlannerReporting()
    },
    audit: {
      trail: createCompliancePlannerAuditTrail(),
      manifest: createCompliancePlannerEvidenceManifest(),
      attestation: createCompliancePlannerReadinessAttestation()
    },
    playbooks: createCompliancePlannerPlaybooks(),
    decisions: createCompliancePlannerDecisionDeck(),
    escalationMoments: createCompliancePlannerEscalationMoments()
  };
}

export function createCompliancePlannerReadinessBoard(snapshot = buildCompliancePlannerSnapshot()) {
  return [
    { id: 'compliance-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCompliancePlannerApiDocument(snapshot = buildCompliancePlannerSnapshot()) {
  return {
    id: 'compliance-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-planner/overview' },
      { method: 'GET', path: '/api/compliance-planner/reporting' },
      { method: 'POST', path: '/api/compliance-planner/validate' },
      { method: 'GET', path: '/api/compliance-planner/audit' }
    ],
    readiness: createCompliancePlannerReadinessBoard(snapshot)
  };
}

export function createCompliancePlannerRouteSummary(snapshot = buildCompliancePlannerSnapshot()) {
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

