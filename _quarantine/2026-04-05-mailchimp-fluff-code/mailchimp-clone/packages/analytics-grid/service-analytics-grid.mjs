import { createAnalyticsGridWorkspace, summarizeAnalyticsGridWorkspace, createAnalyticsGridNarratives, createAnalyticsGridCoverageGrid } from './domain-analytics-grid.mjs';
import { createAnalyticsGridPolicies, validateAnalyticsGridPolicies, summarizeAnalyticsGridPolicies, createAnalyticsGridEscalationDeck } from './policies-analytics-grid.mjs';
import { createAnalyticsGridAnalyticsTimeline, createAnalyticsGridForecastEnvelope, createAnalyticsGridExceptionLedger, summarizeAnalyticsGridAnalytics } from './analytics-analytics-grid.mjs';
import { createAnalyticsGridOperationsBoard, createAnalyticsGridShiftChecklist, createAnalyticsGridIncidentDeck } from './operations-analytics-grid.mjs';
import { createAnalyticsGridReportCards, createAnalyticsGridReviewPackets, summarizeAnalyticsGridReporting } from './reporting-analytics-grid.mjs';
import { createAnalyticsGridAuditTrail, createAnalyticsGridEvidenceManifest, createAnalyticsGridReadinessAttestation } from './audit-analytics-grid.mjs';
import { createAnalyticsGridPlaybooks, createAnalyticsGridDecisionDeck, createAnalyticsGridEscalationMoments } from './playbooks-analytics-grid.mjs';

export function buildAnalyticsGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsGridWorkspace(workspaceName);
  const policies = createAnalyticsGridPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsGridWorkspace(workspace),
    narratives: createAnalyticsGridNarratives(workspace),
    coverage: createAnalyticsGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsGridPolicies(policies),
    validation: validateAnalyticsGridPolicies(policies),
    escalationDeck: createAnalyticsGridEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsGridAnalyticsTimeline(),
      forecast: createAnalyticsGridForecastEnvelope(),
      exceptions: createAnalyticsGridExceptionLedger(),
      summary: summarizeAnalyticsGridAnalytics()
    },
    operations: {
      board: createAnalyticsGridOperationsBoard(),
      checklist: createAnalyticsGridShiftChecklist(),
      incidents: createAnalyticsGridIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsGridReportCards(),
      packets: createAnalyticsGridReviewPackets(),
      summary: summarizeAnalyticsGridReporting()
    },
    audit: {
      trail: createAnalyticsGridAuditTrail(),
      manifest: createAnalyticsGridEvidenceManifest(),
      attestation: createAnalyticsGridReadinessAttestation()
    },
    playbooks: createAnalyticsGridPlaybooks(),
    decisions: createAnalyticsGridDecisionDeck(),
    escalationMoments: createAnalyticsGridEscalationMoments()
  };
}

export function createAnalyticsGridReadinessBoard(snapshot = buildAnalyticsGridSnapshot()) {
  return [
    { id: 'analytics-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsGridApiDocument(snapshot = buildAnalyticsGridSnapshot()) {
  return {
    id: 'analytics-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-grid/overview' },
      { method: 'GET', path: '/api/analytics-grid/reporting' },
      { method: 'POST', path: '/api/analytics-grid/validate' },
      { method: 'GET', path: '/api/analytics-grid/audit' }
    ],
    readiness: createAnalyticsGridReadinessBoard(snapshot)
  };
}

export function createAnalyticsGridRouteSummary(snapshot = buildAnalyticsGridSnapshot()) {
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

