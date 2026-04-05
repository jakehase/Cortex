import { createDataGridWorkspace, summarizeDataGridWorkspace, createDataGridNarratives, createDataGridCoverageGrid } from './domain-data-grid.mjs';
import { createDataGridPolicies, validateDataGridPolicies, summarizeDataGridPolicies, createDataGridEscalationDeck } from './policies-data-grid.mjs';
import { createDataGridAnalyticsTimeline, createDataGridForecastEnvelope, createDataGridExceptionLedger, summarizeDataGridAnalytics } from './analytics-data-grid.mjs';
import { createDataGridOperationsBoard, createDataGridShiftChecklist, createDataGridIncidentDeck } from './operations-data-grid.mjs';
import { createDataGridReportCards, createDataGridReviewPackets, summarizeDataGridReporting } from './reporting-data-grid.mjs';
import { createDataGridAuditTrail, createDataGridEvidenceManifest, createDataGridReadinessAttestation } from './audit-data-grid.mjs';
import { createDataGridPlaybooks, createDataGridDecisionDeck, createDataGridEscalationMoments } from './playbooks-data-grid.mjs';

export function buildDataGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataGridWorkspace(workspaceName);
  const policies = createDataGridPolicies();
  return {
    workspace,
    summary: summarizeDataGridWorkspace(workspace),
    narratives: createDataGridNarratives(workspace),
    coverage: createDataGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataGridPolicies(policies),
    validation: validateDataGridPolicies(policies),
    escalationDeck: createDataGridEscalationDeck(policies),
    analytics: {
      timeline: createDataGridAnalyticsTimeline(),
      forecast: createDataGridForecastEnvelope(),
      exceptions: createDataGridExceptionLedger(),
      summary: summarizeDataGridAnalytics()
    },
    operations: {
      board: createDataGridOperationsBoard(),
      checklist: createDataGridShiftChecklist(),
      incidents: createDataGridIncidentDeck()
    },
    reporting: {
      cards: createDataGridReportCards(),
      packets: createDataGridReviewPackets(),
      summary: summarizeDataGridReporting()
    },
    audit: {
      trail: createDataGridAuditTrail(),
      manifest: createDataGridEvidenceManifest(),
      attestation: createDataGridReadinessAttestation()
    },
    playbooks: createDataGridPlaybooks(),
    decisions: createDataGridDecisionDeck(),
    escalationMoments: createDataGridEscalationMoments()
  };
}

export function createDataGridReadinessBoard(snapshot = buildDataGridSnapshot()) {
  return [
    { id: 'data-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataGridApiDocument(snapshot = buildDataGridSnapshot()) {
  return {
    id: 'data-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-grid/overview' },
      { method: 'GET', path: '/api/data-grid/reporting' },
      { method: 'POST', path: '/api/data-grid/validate' },
      { method: 'GET', path: '/api/data-grid/audit' }
    ],
    readiness: createDataGridReadinessBoard(snapshot)
  };
}

export function createDataGridRouteSummary(snapshot = buildDataGridSnapshot()) {
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

