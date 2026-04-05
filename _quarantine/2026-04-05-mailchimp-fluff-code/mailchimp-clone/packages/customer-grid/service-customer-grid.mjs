import { createCustomerGridWorkspace, summarizeCustomerGridWorkspace, createCustomerGridNarratives, createCustomerGridCoverageGrid } from './domain-customer-grid.mjs';
import { createCustomerGridPolicies, validateCustomerGridPolicies, summarizeCustomerGridPolicies, createCustomerGridEscalationDeck } from './policies-customer-grid.mjs';
import { createCustomerGridAnalyticsTimeline, createCustomerGridForecastEnvelope, createCustomerGridExceptionLedger, summarizeCustomerGridAnalytics } from './analytics-customer-grid.mjs';
import { createCustomerGridOperationsBoard, createCustomerGridShiftChecklist, createCustomerGridIncidentDeck } from './operations-customer-grid.mjs';
import { createCustomerGridReportCards, createCustomerGridReviewPackets, summarizeCustomerGridReporting } from './reporting-customer-grid.mjs';
import { createCustomerGridAuditTrail, createCustomerGridEvidenceManifest, createCustomerGridReadinessAttestation } from './audit-customer-grid.mjs';
import { createCustomerGridPlaybooks, createCustomerGridDecisionDeck, createCustomerGridEscalationMoments } from './playbooks-customer-grid.mjs';

export function buildCustomerGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerGridWorkspace(workspaceName);
  const policies = createCustomerGridPolicies();
  return {
    workspace,
    summary: summarizeCustomerGridWorkspace(workspace),
    narratives: createCustomerGridNarratives(workspace),
    coverage: createCustomerGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerGridPolicies(policies),
    validation: validateCustomerGridPolicies(policies),
    escalationDeck: createCustomerGridEscalationDeck(policies),
    analytics: {
      timeline: createCustomerGridAnalyticsTimeline(),
      forecast: createCustomerGridForecastEnvelope(),
      exceptions: createCustomerGridExceptionLedger(),
      summary: summarizeCustomerGridAnalytics()
    },
    operations: {
      board: createCustomerGridOperationsBoard(),
      checklist: createCustomerGridShiftChecklist(),
      incidents: createCustomerGridIncidentDeck()
    },
    reporting: {
      cards: createCustomerGridReportCards(),
      packets: createCustomerGridReviewPackets(),
      summary: summarizeCustomerGridReporting()
    },
    audit: {
      trail: createCustomerGridAuditTrail(),
      manifest: createCustomerGridEvidenceManifest(),
      attestation: createCustomerGridReadinessAttestation()
    },
    playbooks: createCustomerGridPlaybooks(),
    decisions: createCustomerGridDecisionDeck(),
    escalationMoments: createCustomerGridEscalationMoments()
  };
}

export function createCustomerGridReadinessBoard(snapshot = buildCustomerGridSnapshot()) {
  return [
    { id: 'customer-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerGridApiDocument(snapshot = buildCustomerGridSnapshot()) {
  return {
    id: 'customer-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-grid/overview' },
      { method: 'GET', path: '/api/customer-grid/reporting' },
      { method: 'POST', path: '/api/customer-grid/validate' },
      { method: 'GET', path: '/api/customer-grid/audit' }
    ],
    readiness: createCustomerGridReadinessBoard(snapshot)
  };
}

export function createCustomerGridRouteSummary(snapshot = buildCustomerGridSnapshot()) {
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

