import { createIntegrationsPlannerWorkspace, summarizeIntegrationsPlannerWorkspace, createIntegrationsPlannerNarratives, createIntegrationsPlannerCoverageGrid } from './domain-integrations-planner.mjs';
import { createIntegrationsPlannerPolicies, validateIntegrationsPlannerPolicies, summarizeIntegrationsPlannerPolicies, createIntegrationsPlannerEscalationDeck } from './policies-integrations-planner.mjs';
import { createIntegrationsPlannerAnalyticsTimeline, createIntegrationsPlannerForecastEnvelope, createIntegrationsPlannerExceptionLedger, summarizeIntegrationsPlannerAnalytics } from './analytics-integrations-planner.mjs';
import { createIntegrationsPlannerOperationsBoard, createIntegrationsPlannerShiftChecklist, createIntegrationsPlannerIncidentDeck } from './operations-integrations-planner.mjs';
import { createIntegrationsPlannerReportCards, createIntegrationsPlannerReviewPackets, summarizeIntegrationsPlannerReporting } from './reporting-integrations-planner.mjs';
import { createIntegrationsPlannerAuditTrail, createIntegrationsPlannerEvidenceManifest, createIntegrationsPlannerReadinessAttestation } from './audit-integrations-planner.mjs';
import { createIntegrationsPlannerPlaybooks, createIntegrationsPlannerDecisionDeck, createIntegrationsPlannerEscalationMoments } from './playbooks-integrations-planner.mjs';

export function buildIntegrationsPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsPlannerWorkspace(workspaceName);
  const policies = createIntegrationsPlannerPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsPlannerWorkspace(workspace),
    narratives: createIntegrationsPlannerNarratives(workspace),
    coverage: createIntegrationsPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsPlannerPolicies(policies),
    validation: validateIntegrationsPlannerPolicies(policies),
    escalationDeck: createIntegrationsPlannerEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsPlannerAnalyticsTimeline(),
      forecast: createIntegrationsPlannerForecastEnvelope(),
      exceptions: createIntegrationsPlannerExceptionLedger(),
      summary: summarizeIntegrationsPlannerAnalytics()
    },
    operations: {
      board: createIntegrationsPlannerOperationsBoard(),
      checklist: createIntegrationsPlannerShiftChecklist(),
      incidents: createIntegrationsPlannerIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsPlannerReportCards(),
      packets: createIntegrationsPlannerReviewPackets(),
      summary: summarizeIntegrationsPlannerReporting()
    },
    audit: {
      trail: createIntegrationsPlannerAuditTrail(),
      manifest: createIntegrationsPlannerEvidenceManifest(),
      attestation: createIntegrationsPlannerReadinessAttestation()
    },
    playbooks: createIntegrationsPlannerPlaybooks(),
    decisions: createIntegrationsPlannerDecisionDeck(),
    escalationMoments: createIntegrationsPlannerEscalationMoments()
  };
}

export function createIntegrationsPlannerReadinessBoard(snapshot = buildIntegrationsPlannerSnapshot()) {
  return [
    { id: 'integrations-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsPlannerApiDocument(snapshot = buildIntegrationsPlannerSnapshot()) {
  return {
    id: 'integrations-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-planner/overview' },
      { method: 'GET', path: '/api/integrations-planner/reporting' },
      { method: 'POST', path: '/api/integrations-planner/validate' },
      { method: 'GET', path: '/api/integrations-planner/audit' }
    ],
    readiness: createIntegrationsPlannerReadinessBoard(snapshot)
  };
}

export function createIntegrationsPlannerRouteSummary(snapshot = buildIntegrationsPlannerSnapshot()) {
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

