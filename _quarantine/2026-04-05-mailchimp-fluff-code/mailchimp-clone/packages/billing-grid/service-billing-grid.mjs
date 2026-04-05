import { createBillingGridWorkspace, summarizeBillingGridWorkspace, createBillingGridNarratives, createBillingGridCoverageGrid } from './domain-billing-grid.mjs';
import { createBillingGridPolicies, validateBillingGridPolicies, summarizeBillingGridPolicies, createBillingGridEscalationDeck } from './policies-billing-grid.mjs';
import { createBillingGridAnalyticsTimeline, createBillingGridForecastEnvelope, createBillingGridExceptionLedger, summarizeBillingGridAnalytics } from './analytics-billing-grid.mjs';
import { createBillingGridOperationsBoard, createBillingGridShiftChecklist, createBillingGridIncidentDeck } from './operations-billing-grid.mjs';
import { createBillingGridReportCards, createBillingGridReviewPackets, summarizeBillingGridReporting } from './reporting-billing-grid.mjs';
import { createBillingGridAuditTrail, createBillingGridEvidenceManifest, createBillingGridReadinessAttestation } from './audit-billing-grid.mjs';
import { createBillingGridPlaybooks, createBillingGridDecisionDeck, createBillingGridEscalationMoments } from './playbooks-billing-grid.mjs';

export function buildBillingGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingGridWorkspace(workspaceName);
  const policies = createBillingGridPolicies();
  return {
    workspace,
    summary: summarizeBillingGridWorkspace(workspace),
    narratives: createBillingGridNarratives(workspace),
    coverage: createBillingGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingGridPolicies(policies),
    validation: validateBillingGridPolicies(policies),
    escalationDeck: createBillingGridEscalationDeck(policies),
    analytics: {
      timeline: createBillingGridAnalyticsTimeline(),
      forecast: createBillingGridForecastEnvelope(),
      exceptions: createBillingGridExceptionLedger(),
      summary: summarizeBillingGridAnalytics()
    },
    operations: {
      board: createBillingGridOperationsBoard(),
      checklist: createBillingGridShiftChecklist(),
      incidents: createBillingGridIncidentDeck()
    },
    reporting: {
      cards: createBillingGridReportCards(),
      packets: createBillingGridReviewPackets(),
      summary: summarizeBillingGridReporting()
    },
    audit: {
      trail: createBillingGridAuditTrail(),
      manifest: createBillingGridEvidenceManifest(),
      attestation: createBillingGridReadinessAttestation()
    },
    playbooks: createBillingGridPlaybooks(),
    decisions: createBillingGridDecisionDeck(),
    escalationMoments: createBillingGridEscalationMoments()
  };
}

export function createBillingGridReadinessBoard(snapshot = buildBillingGridSnapshot()) {
  return [
    { id: 'billing-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingGridApiDocument(snapshot = buildBillingGridSnapshot()) {
  return {
    id: 'billing-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-grid/overview' },
      { method: 'GET', path: '/api/billing-grid/reporting' },
      { method: 'POST', path: '/api/billing-grid/validate' },
      { method: 'GET', path: '/api/billing-grid/audit' }
    ],
    readiness: createBillingGridReadinessBoard(snapshot)
  };
}

export function createBillingGridRouteSummary(snapshot = buildBillingGridSnapshot()) {
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

