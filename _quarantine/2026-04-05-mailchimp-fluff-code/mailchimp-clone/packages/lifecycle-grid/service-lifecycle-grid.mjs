import { createLifecycleGridWorkspace, summarizeLifecycleGridWorkspace, createLifecycleGridNarratives, createLifecycleGridCoverageGrid } from './domain-lifecycle-grid.mjs';
import { createLifecycleGridPolicies, validateLifecycleGridPolicies, summarizeLifecycleGridPolicies, createLifecycleGridEscalationDeck } from './policies-lifecycle-grid.mjs';
import { createLifecycleGridAnalyticsTimeline, createLifecycleGridForecastEnvelope, createLifecycleGridExceptionLedger, summarizeLifecycleGridAnalytics } from './analytics-lifecycle-grid.mjs';
import { createLifecycleGridOperationsBoard, createLifecycleGridShiftChecklist, createLifecycleGridIncidentDeck } from './operations-lifecycle-grid.mjs';
import { createLifecycleGridReportCards, createLifecycleGridReviewPackets, summarizeLifecycleGridReporting } from './reporting-lifecycle-grid.mjs';
import { createLifecycleGridAuditTrail, createLifecycleGridEvidenceManifest, createLifecycleGridReadinessAttestation } from './audit-lifecycle-grid.mjs';
import { createLifecycleGridPlaybooks, createLifecycleGridDecisionDeck, createLifecycleGridEscalationMoments } from './playbooks-lifecycle-grid.mjs';

export function buildLifecycleGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleGridWorkspace(workspaceName);
  const policies = createLifecycleGridPolicies();
  return {
    workspace,
    summary: summarizeLifecycleGridWorkspace(workspace),
    narratives: createLifecycleGridNarratives(workspace),
    coverage: createLifecycleGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleGridPolicies(policies),
    validation: validateLifecycleGridPolicies(policies),
    escalationDeck: createLifecycleGridEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleGridAnalyticsTimeline(),
      forecast: createLifecycleGridForecastEnvelope(),
      exceptions: createLifecycleGridExceptionLedger(),
      summary: summarizeLifecycleGridAnalytics()
    },
    operations: {
      board: createLifecycleGridOperationsBoard(),
      checklist: createLifecycleGridShiftChecklist(),
      incidents: createLifecycleGridIncidentDeck()
    },
    reporting: {
      cards: createLifecycleGridReportCards(),
      packets: createLifecycleGridReviewPackets(),
      summary: summarizeLifecycleGridReporting()
    },
    audit: {
      trail: createLifecycleGridAuditTrail(),
      manifest: createLifecycleGridEvidenceManifest(),
      attestation: createLifecycleGridReadinessAttestation()
    },
    playbooks: createLifecycleGridPlaybooks(),
    decisions: createLifecycleGridDecisionDeck(),
    escalationMoments: createLifecycleGridEscalationMoments()
  };
}

export function createLifecycleGridReadinessBoard(snapshot = buildLifecycleGridSnapshot()) {
  return [
    { id: 'lifecycle-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleGridApiDocument(snapshot = buildLifecycleGridSnapshot()) {
  return {
    id: 'lifecycle-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-grid/overview' },
      { method: 'GET', path: '/api/lifecycle-grid/reporting' },
      { method: 'POST', path: '/api/lifecycle-grid/validate' },
      { method: 'GET', path: '/api/lifecycle-grid/audit' }
    ],
    readiness: createLifecycleGridReadinessBoard(snapshot)
  };
}

export function createLifecycleGridRouteSummary(snapshot = buildLifecycleGridSnapshot()) {
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

