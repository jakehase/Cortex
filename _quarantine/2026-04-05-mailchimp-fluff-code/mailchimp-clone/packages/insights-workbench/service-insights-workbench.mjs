import { createInsightsWorkbenchWorkspace, summarizeInsightsWorkbenchWorkspace, createInsightsWorkbenchNarratives, createInsightsWorkbenchCoverageGrid } from './domain-insights-workbench.mjs';
import { createInsightsWorkbenchPolicies, validateInsightsWorkbenchPolicies, summarizeInsightsWorkbenchPolicies, createInsightsWorkbenchEscalationDeck } from './policies-insights-workbench.mjs';
import { createInsightsWorkbenchAnalyticsTimeline, createInsightsWorkbenchForecastEnvelope, createInsightsWorkbenchExceptionLedger, summarizeInsightsWorkbenchAnalytics } from './analytics-insights-workbench.mjs';
import { createInsightsWorkbenchOperationsBoard, createInsightsWorkbenchShiftChecklist, createInsightsWorkbenchIncidentDeck } from './operations-insights-workbench.mjs';
import { createInsightsWorkbenchReportCards, createInsightsWorkbenchReviewPackets, summarizeInsightsWorkbenchReporting } from './reporting-insights-workbench.mjs';
import { createInsightsWorkbenchAuditTrail, createInsightsWorkbenchEvidenceManifest, createInsightsWorkbenchReadinessAttestation } from './audit-insights-workbench.mjs';
import { createInsightsWorkbenchPlaybooks, createInsightsWorkbenchDecisionDeck, createInsightsWorkbenchEscalationMoments } from './playbooks-insights-workbench.mjs';

export function buildInsightsWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsWorkbenchWorkspace(workspaceName);
  const policies = createInsightsWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeInsightsWorkbenchWorkspace(workspace),
    narratives: createInsightsWorkbenchNarratives(workspace),
    coverage: createInsightsWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsWorkbenchPolicies(policies),
    validation: validateInsightsWorkbenchPolicies(policies),
    escalationDeck: createInsightsWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createInsightsWorkbenchAnalyticsTimeline(),
      forecast: createInsightsWorkbenchForecastEnvelope(),
      exceptions: createInsightsWorkbenchExceptionLedger(),
      summary: summarizeInsightsWorkbenchAnalytics()
    },
    operations: {
      board: createInsightsWorkbenchOperationsBoard(),
      checklist: createInsightsWorkbenchShiftChecklist(),
      incidents: createInsightsWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createInsightsWorkbenchReportCards(),
      packets: createInsightsWorkbenchReviewPackets(),
      summary: summarizeInsightsWorkbenchReporting()
    },
    audit: {
      trail: createInsightsWorkbenchAuditTrail(),
      manifest: createInsightsWorkbenchEvidenceManifest(),
      attestation: createInsightsWorkbenchReadinessAttestation()
    },
    playbooks: createInsightsWorkbenchPlaybooks(),
    decisions: createInsightsWorkbenchDecisionDeck(),
    escalationMoments: createInsightsWorkbenchEscalationMoments()
  };
}

export function createInsightsWorkbenchReadinessBoard(snapshot = buildInsightsWorkbenchSnapshot()) {
  return [
    { id: 'insights-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsWorkbenchApiDocument(snapshot = buildInsightsWorkbenchSnapshot()) {
  return {
    id: 'insights-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-workbench/overview' },
      { method: 'GET', path: '/api/insights-workbench/reporting' },
      { method: 'POST', path: '/api/insights-workbench/validate' },
      { method: 'GET', path: '/api/insights-workbench/audit' }
    ],
    readiness: createInsightsWorkbenchReadinessBoard(snapshot)
  };
}

export function createInsightsWorkbenchRouteSummary(snapshot = buildInsightsWorkbenchSnapshot()) {
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

