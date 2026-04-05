import { createContentGridWorkspace, summarizeContentGridWorkspace, createContentGridNarratives, createContentGridCoverageGrid } from './domain-content-grid.mjs';
import { createContentGridPolicies, validateContentGridPolicies, summarizeContentGridPolicies, createContentGridEscalationDeck } from './policies-content-grid.mjs';
import { createContentGridAnalyticsTimeline, createContentGridForecastEnvelope, createContentGridExceptionLedger, summarizeContentGridAnalytics } from './analytics-content-grid.mjs';
import { createContentGridOperationsBoard, createContentGridShiftChecklist, createContentGridIncidentDeck } from './operations-content-grid.mjs';
import { createContentGridReportCards, createContentGridReviewPackets, summarizeContentGridReporting } from './reporting-content-grid.mjs';
import { createContentGridAuditTrail, createContentGridEvidenceManifest, createContentGridReadinessAttestation } from './audit-content-grid.mjs';
import { createContentGridPlaybooks, createContentGridDecisionDeck, createContentGridEscalationMoments } from './playbooks-content-grid.mjs';

export function buildContentGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentGridWorkspace(workspaceName);
  const policies = createContentGridPolicies();
  return {
    workspace,
    summary: summarizeContentGridWorkspace(workspace),
    narratives: createContentGridNarratives(workspace),
    coverage: createContentGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentGridPolicies(policies),
    validation: validateContentGridPolicies(policies),
    escalationDeck: createContentGridEscalationDeck(policies),
    analytics: {
      timeline: createContentGridAnalyticsTimeline(),
      forecast: createContentGridForecastEnvelope(),
      exceptions: createContentGridExceptionLedger(),
      summary: summarizeContentGridAnalytics()
    },
    operations: {
      board: createContentGridOperationsBoard(),
      checklist: createContentGridShiftChecklist(),
      incidents: createContentGridIncidentDeck()
    },
    reporting: {
      cards: createContentGridReportCards(),
      packets: createContentGridReviewPackets(),
      summary: summarizeContentGridReporting()
    },
    audit: {
      trail: createContentGridAuditTrail(),
      manifest: createContentGridEvidenceManifest(),
      attestation: createContentGridReadinessAttestation()
    },
    playbooks: createContentGridPlaybooks(),
    decisions: createContentGridDecisionDeck(),
    escalationMoments: createContentGridEscalationMoments()
  };
}

export function createContentGridReadinessBoard(snapshot = buildContentGridSnapshot()) {
  return [
    { id: 'content-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentGridApiDocument(snapshot = buildContentGridSnapshot()) {
  return {
    id: 'content-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-grid/overview' },
      { method: 'GET', path: '/api/content-grid/reporting' },
      { method: 'POST', path: '/api/content-grid/validate' },
      { method: 'GET', path: '/api/content-grid/audit' }
    ],
    readiness: createContentGridReadinessBoard(snapshot)
  };
}

export function createContentGridRouteSummary(snapshot = buildContentGridSnapshot()) {
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

