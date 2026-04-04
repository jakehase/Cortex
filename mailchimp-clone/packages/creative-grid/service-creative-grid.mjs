import { createCreativeGridWorkspace, summarizeCreativeGridWorkspace, createCreativeGridNarratives, createCreativeGridCoverageGrid } from './domain-creative-grid.mjs';
import { createCreativeGridPolicies, validateCreativeGridPolicies, summarizeCreativeGridPolicies, createCreativeGridEscalationDeck } from './policies-creative-grid.mjs';
import { createCreativeGridAnalyticsTimeline, createCreativeGridForecastEnvelope, createCreativeGridExceptionLedger, summarizeCreativeGridAnalytics } from './analytics-creative-grid.mjs';
import { createCreativeGridOperationsBoard, createCreativeGridShiftChecklist, createCreativeGridIncidentDeck } from './operations-creative-grid.mjs';
import { createCreativeGridReportCards, createCreativeGridReviewPackets, summarizeCreativeGridReporting } from './reporting-creative-grid.mjs';
import { createCreativeGridAuditTrail, createCreativeGridEvidenceManifest, createCreativeGridReadinessAttestation } from './audit-creative-grid.mjs';
import { createCreativeGridPlaybooks, createCreativeGridDecisionDeck, createCreativeGridEscalationMoments } from './playbooks-creative-grid.mjs';

export function buildCreativeGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeGridWorkspace(workspaceName);
  const policies = createCreativeGridPolicies();
  return {
    workspace,
    summary: summarizeCreativeGridWorkspace(workspace),
    narratives: createCreativeGridNarratives(workspace),
    coverage: createCreativeGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeGridPolicies(policies),
    validation: validateCreativeGridPolicies(policies),
    escalationDeck: createCreativeGridEscalationDeck(policies),
    analytics: {
      timeline: createCreativeGridAnalyticsTimeline(),
      forecast: createCreativeGridForecastEnvelope(),
      exceptions: createCreativeGridExceptionLedger(),
      summary: summarizeCreativeGridAnalytics()
    },
    operations: {
      board: createCreativeGridOperationsBoard(),
      checklist: createCreativeGridShiftChecklist(),
      incidents: createCreativeGridIncidentDeck()
    },
    reporting: {
      cards: createCreativeGridReportCards(),
      packets: createCreativeGridReviewPackets(),
      summary: summarizeCreativeGridReporting()
    },
    audit: {
      trail: createCreativeGridAuditTrail(),
      manifest: createCreativeGridEvidenceManifest(),
      attestation: createCreativeGridReadinessAttestation()
    },
    playbooks: createCreativeGridPlaybooks(),
    decisions: createCreativeGridDecisionDeck(),
    escalationMoments: createCreativeGridEscalationMoments()
  };
}

export function createCreativeGridReadinessBoard(snapshot = buildCreativeGridSnapshot()) {
  return [
    { id: 'creative-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeGridApiDocument(snapshot = buildCreativeGridSnapshot()) {
  return {
    id: 'creative-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-grid/overview' },
      { method: 'GET', path: '/api/creative-grid/reporting' },
      { method: 'POST', path: '/api/creative-grid/validate' },
      { method: 'GET', path: '/api/creative-grid/audit' }
    ],
    readiness: createCreativeGridReadinessBoard(snapshot)
  };
}

export function createCreativeGridRouteSummary(snapshot = buildCreativeGridSnapshot()) {
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

