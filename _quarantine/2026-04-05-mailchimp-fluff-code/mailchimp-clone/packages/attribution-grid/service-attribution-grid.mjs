import { createAttributionGridWorkspace, summarizeAttributionGridWorkspace, createAttributionGridNarratives, createAttributionGridCoverageGrid } from './domain-attribution-grid.mjs';
import { createAttributionGridPolicies, validateAttributionGridPolicies, summarizeAttributionGridPolicies, createAttributionGridEscalationDeck } from './policies-attribution-grid.mjs';
import { createAttributionGridAnalyticsTimeline, createAttributionGridForecastEnvelope, createAttributionGridExceptionLedger, summarizeAttributionGridAnalytics } from './analytics-attribution-grid.mjs';
import { createAttributionGridOperationsBoard, createAttributionGridShiftChecklist, createAttributionGridIncidentDeck } from './operations-attribution-grid.mjs';
import { createAttributionGridReportCards, createAttributionGridReviewPackets, summarizeAttributionGridReporting } from './reporting-attribution-grid.mjs';
import { createAttributionGridAuditTrail, createAttributionGridEvidenceManifest, createAttributionGridReadinessAttestation } from './audit-attribution-grid.mjs';
import { createAttributionGridPlaybooks, createAttributionGridDecisionDeck, createAttributionGridEscalationMoments } from './playbooks-attribution-grid.mjs';

export function buildAttributionGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionGridWorkspace(workspaceName);
  const policies = createAttributionGridPolicies();
  return {
    workspace,
    summary: summarizeAttributionGridWorkspace(workspace),
    narratives: createAttributionGridNarratives(workspace),
    coverage: createAttributionGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionGridPolicies(policies),
    validation: validateAttributionGridPolicies(policies),
    escalationDeck: createAttributionGridEscalationDeck(policies),
    analytics: {
      timeline: createAttributionGridAnalyticsTimeline(),
      forecast: createAttributionGridForecastEnvelope(),
      exceptions: createAttributionGridExceptionLedger(),
      summary: summarizeAttributionGridAnalytics()
    },
    operations: {
      board: createAttributionGridOperationsBoard(),
      checklist: createAttributionGridShiftChecklist(),
      incidents: createAttributionGridIncidentDeck()
    },
    reporting: {
      cards: createAttributionGridReportCards(),
      packets: createAttributionGridReviewPackets(),
      summary: summarizeAttributionGridReporting()
    },
    audit: {
      trail: createAttributionGridAuditTrail(),
      manifest: createAttributionGridEvidenceManifest(),
      attestation: createAttributionGridReadinessAttestation()
    },
    playbooks: createAttributionGridPlaybooks(),
    decisions: createAttributionGridDecisionDeck(),
    escalationMoments: createAttributionGridEscalationMoments()
  };
}

export function createAttributionGridReadinessBoard(snapshot = buildAttributionGridSnapshot()) {
  return [
    { id: 'attribution-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionGridApiDocument(snapshot = buildAttributionGridSnapshot()) {
  return {
    id: 'attribution-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-grid/overview' },
      { method: 'GET', path: '/api/attribution-grid/reporting' },
      { method: 'POST', path: '/api/attribution-grid/validate' },
      { method: 'GET', path: '/api/attribution-grid/audit' }
    ],
    readiness: createAttributionGridReadinessBoard(snapshot)
  };
}

export function createAttributionGridRouteSummary(snapshot = buildAttributionGridSnapshot()) {
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

