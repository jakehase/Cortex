import { createDeliverabilityGridWorkspace, summarizeDeliverabilityGridWorkspace, createDeliverabilityGridNarratives, createDeliverabilityGridCoverageGrid } from './domain-deliverability-grid.mjs';
import { createDeliverabilityGridPolicies, validateDeliverabilityGridPolicies, summarizeDeliverabilityGridPolicies, createDeliverabilityGridEscalationDeck } from './policies-deliverability-grid.mjs';
import { createDeliverabilityGridAnalyticsTimeline, createDeliverabilityGridForecastEnvelope, createDeliverabilityGridExceptionLedger, summarizeDeliverabilityGridAnalytics } from './analytics-deliverability-grid.mjs';
import { createDeliverabilityGridOperationsBoard, createDeliverabilityGridShiftChecklist, createDeliverabilityGridIncidentDeck } from './operations-deliverability-grid.mjs';
import { createDeliverabilityGridReportCards, createDeliverabilityGridReviewPackets, summarizeDeliverabilityGridReporting } from './reporting-deliverability-grid.mjs';
import { createDeliverabilityGridAuditTrail, createDeliverabilityGridEvidenceManifest, createDeliverabilityGridReadinessAttestation } from './audit-deliverability-grid.mjs';
import { createDeliverabilityGridPlaybooks, createDeliverabilityGridDecisionDeck, createDeliverabilityGridEscalationMoments } from './playbooks-deliverability-grid.mjs';

export function buildDeliverabilityGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityGridWorkspace(workspaceName);
  const policies = createDeliverabilityGridPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityGridWorkspace(workspace),
    narratives: createDeliverabilityGridNarratives(workspace),
    coverage: createDeliverabilityGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityGridPolicies(policies),
    validation: validateDeliverabilityGridPolicies(policies),
    escalationDeck: createDeliverabilityGridEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityGridAnalyticsTimeline(),
      forecast: createDeliverabilityGridForecastEnvelope(),
      exceptions: createDeliverabilityGridExceptionLedger(),
      summary: summarizeDeliverabilityGridAnalytics()
    },
    operations: {
      board: createDeliverabilityGridOperationsBoard(),
      checklist: createDeliverabilityGridShiftChecklist(),
      incidents: createDeliverabilityGridIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityGridReportCards(),
      packets: createDeliverabilityGridReviewPackets(),
      summary: summarizeDeliverabilityGridReporting()
    },
    audit: {
      trail: createDeliverabilityGridAuditTrail(),
      manifest: createDeliverabilityGridEvidenceManifest(),
      attestation: createDeliverabilityGridReadinessAttestation()
    },
    playbooks: createDeliverabilityGridPlaybooks(),
    decisions: createDeliverabilityGridDecisionDeck(),
    escalationMoments: createDeliverabilityGridEscalationMoments()
  };
}

export function createDeliverabilityGridReadinessBoard(snapshot = buildDeliverabilityGridSnapshot()) {
  return [
    { id: 'deliverability-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityGridApiDocument(snapshot = buildDeliverabilityGridSnapshot()) {
  return {
    id: 'deliverability-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-grid/overview' },
      { method: 'GET', path: '/api/deliverability-grid/reporting' },
      { method: 'POST', path: '/api/deliverability-grid/validate' },
      { method: 'GET', path: '/api/deliverability-grid/audit' }
    ],
    readiness: createDeliverabilityGridReadinessBoard(snapshot)
  };
}

export function createDeliverabilityGridRouteSummary(snapshot = buildDeliverabilityGridSnapshot()) {
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

