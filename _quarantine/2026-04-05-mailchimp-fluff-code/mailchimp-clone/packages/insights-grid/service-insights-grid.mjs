import { createInsightsGridWorkspace, summarizeInsightsGridWorkspace, createInsightsGridNarratives, createInsightsGridCoverageGrid } from './domain-insights-grid.mjs';
import { createInsightsGridPolicies, validateInsightsGridPolicies, summarizeInsightsGridPolicies, createInsightsGridEscalationDeck } from './policies-insights-grid.mjs';
import { createInsightsGridAnalyticsTimeline, createInsightsGridForecastEnvelope, createInsightsGridExceptionLedger, summarizeInsightsGridAnalytics } from './analytics-insights-grid.mjs';
import { createInsightsGridOperationsBoard, createInsightsGridShiftChecklist, createInsightsGridIncidentDeck } from './operations-insights-grid.mjs';
import { createInsightsGridReportCards, createInsightsGridReviewPackets, summarizeInsightsGridReporting } from './reporting-insights-grid.mjs';
import { createInsightsGridAuditTrail, createInsightsGridEvidenceManifest, createInsightsGridReadinessAttestation } from './audit-insights-grid.mjs';
import { createInsightsGridPlaybooks, createInsightsGridDecisionDeck, createInsightsGridEscalationMoments } from './playbooks-insights-grid.mjs';

export function buildInsightsGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsGridWorkspace(workspaceName);
  const policies = createInsightsGridPolicies();
  return {
    workspace,
    summary: summarizeInsightsGridWorkspace(workspace),
    narratives: createInsightsGridNarratives(workspace),
    coverage: createInsightsGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsGridPolicies(policies),
    validation: validateInsightsGridPolicies(policies),
    escalationDeck: createInsightsGridEscalationDeck(policies),
    analytics: {
      timeline: createInsightsGridAnalyticsTimeline(),
      forecast: createInsightsGridForecastEnvelope(),
      exceptions: createInsightsGridExceptionLedger(),
      summary: summarizeInsightsGridAnalytics()
    },
    operations: {
      board: createInsightsGridOperationsBoard(),
      checklist: createInsightsGridShiftChecklist(),
      incidents: createInsightsGridIncidentDeck()
    },
    reporting: {
      cards: createInsightsGridReportCards(),
      packets: createInsightsGridReviewPackets(),
      summary: summarizeInsightsGridReporting()
    },
    audit: {
      trail: createInsightsGridAuditTrail(),
      manifest: createInsightsGridEvidenceManifest(),
      attestation: createInsightsGridReadinessAttestation()
    },
    playbooks: createInsightsGridPlaybooks(),
    decisions: createInsightsGridDecisionDeck(),
    escalationMoments: createInsightsGridEscalationMoments()
  };
}

export function createInsightsGridReadinessBoard(snapshot = buildInsightsGridSnapshot()) {
  return [
    { id: 'insights-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsGridApiDocument(snapshot = buildInsightsGridSnapshot()) {
  return {
    id: 'insights-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-grid/overview' },
      { method: 'GET', path: '/api/insights-grid/reporting' },
      { method: 'POST', path: '/api/insights-grid/validate' },
      { method: 'GET', path: '/api/insights-grid/audit' }
    ],
    readiness: createInsightsGridReadinessBoard(snapshot)
  };
}

export function createInsightsGridRouteSummary(snapshot = buildInsightsGridSnapshot()) {
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

