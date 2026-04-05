import { createActivationGridWorkspace, summarizeActivationGridWorkspace, createActivationGridNarratives, createActivationGridCoverageGrid } from './domain-activation-grid.mjs';
import { createActivationGridPolicies, validateActivationGridPolicies, summarizeActivationGridPolicies, createActivationGridEscalationDeck } from './policies-activation-grid.mjs';
import { createActivationGridAnalyticsTimeline, createActivationGridForecastEnvelope, createActivationGridExceptionLedger, summarizeActivationGridAnalytics } from './analytics-activation-grid.mjs';
import { createActivationGridOperationsBoard, createActivationGridShiftChecklist, createActivationGridIncidentDeck } from './operations-activation-grid.mjs';
import { createActivationGridReportCards, createActivationGridReviewPackets, summarizeActivationGridReporting } from './reporting-activation-grid.mjs';
import { createActivationGridAuditTrail, createActivationGridEvidenceManifest, createActivationGridReadinessAttestation } from './audit-activation-grid.mjs';
import { createActivationGridPlaybooks, createActivationGridDecisionDeck, createActivationGridEscalationMoments } from './playbooks-activation-grid.mjs';

export function buildActivationGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationGridWorkspace(workspaceName);
  const policies = createActivationGridPolicies();
  return {
    workspace,
    summary: summarizeActivationGridWorkspace(workspace),
    narratives: createActivationGridNarratives(workspace),
    coverage: createActivationGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationGridPolicies(policies),
    validation: validateActivationGridPolicies(policies),
    escalationDeck: createActivationGridEscalationDeck(policies),
    analytics: {
      timeline: createActivationGridAnalyticsTimeline(),
      forecast: createActivationGridForecastEnvelope(),
      exceptions: createActivationGridExceptionLedger(),
      summary: summarizeActivationGridAnalytics()
    },
    operations: {
      board: createActivationGridOperationsBoard(),
      checklist: createActivationGridShiftChecklist(),
      incidents: createActivationGridIncidentDeck()
    },
    reporting: {
      cards: createActivationGridReportCards(),
      packets: createActivationGridReviewPackets(),
      summary: summarizeActivationGridReporting()
    },
    audit: {
      trail: createActivationGridAuditTrail(),
      manifest: createActivationGridEvidenceManifest(),
      attestation: createActivationGridReadinessAttestation()
    },
    playbooks: createActivationGridPlaybooks(),
    decisions: createActivationGridDecisionDeck(),
    escalationMoments: createActivationGridEscalationMoments()
  };
}

export function createActivationGridReadinessBoard(snapshot = buildActivationGridSnapshot()) {
  return [
    { id: 'activation-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationGridApiDocument(snapshot = buildActivationGridSnapshot()) {
  return {
    id: 'activation-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-grid/overview' },
      { method: 'GET', path: '/api/activation-grid/reporting' },
      { method: 'POST', path: '/api/activation-grid/validate' },
      { method: 'GET', path: '/api/activation-grid/audit' }
    ],
    readiness: createActivationGridReadinessBoard(snapshot)
  };
}

export function createActivationGridRouteSummary(snapshot = buildActivationGridSnapshot()) {
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

