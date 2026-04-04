import { createEcommerceGridWorkspace, summarizeEcommerceGridWorkspace, createEcommerceGridNarratives, createEcommerceGridCoverageGrid } from './domain-ecommerce-grid.mjs';
import { createEcommerceGridPolicies, validateEcommerceGridPolicies, summarizeEcommerceGridPolicies, createEcommerceGridEscalationDeck } from './policies-ecommerce-grid.mjs';
import { createEcommerceGridAnalyticsTimeline, createEcommerceGridForecastEnvelope, createEcommerceGridExceptionLedger, summarizeEcommerceGridAnalytics } from './analytics-ecommerce-grid.mjs';
import { createEcommerceGridOperationsBoard, createEcommerceGridShiftChecklist, createEcommerceGridIncidentDeck } from './operations-ecommerce-grid.mjs';
import { createEcommerceGridReportCards, createEcommerceGridReviewPackets, summarizeEcommerceGridReporting } from './reporting-ecommerce-grid.mjs';
import { createEcommerceGridAuditTrail, createEcommerceGridEvidenceManifest, createEcommerceGridReadinessAttestation } from './audit-ecommerce-grid.mjs';
import { createEcommerceGridPlaybooks, createEcommerceGridDecisionDeck, createEcommerceGridEscalationMoments } from './playbooks-ecommerce-grid.mjs';

export function buildEcommerceGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceGridWorkspace(workspaceName);
  const policies = createEcommerceGridPolicies();
  return {
    workspace,
    summary: summarizeEcommerceGridWorkspace(workspace),
    narratives: createEcommerceGridNarratives(workspace),
    coverage: createEcommerceGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceGridPolicies(policies),
    validation: validateEcommerceGridPolicies(policies),
    escalationDeck: createEcommerceGridEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceGridAnalyticsTimeline(),
      forecast: createEcommerceGridForecastEnvelope(),
      exceptions: createEcommerceGridExceptionLedger(),
      summary: summarizeEcommerceGridAnalytics()
    },
    operations: {
      board: createEcommerceGridOperationsBoard(),
      checklist: createEcommerceGridShiftChecklist(),
      incidents: createEcommerceGridIncidentDeck()
    },
    reporting: {
      cards: createEcommerceGridReportCards(),
      packets: createEcommerceGridReviewPackets(),
      summary: summarizeEcommerceGridReporting()
    },
    audit: {
      trail: createEcommerceGridAuditTrail(),
      manifest: createEcommerceGridEvidenceManifest(),
      attestation: createEcommerceGridReadinessAttestation()
    },
    playbooks: createEcommerceGridPlaybooks(),
    decisions: createEcommerceGridDecisionDeck(),
    escalationMoments: createEcommerceGridEscalationMoments()
  };
}

export function createEcommerceGridReadinessBoard(snapshot = buildEcommerceGridSnapshot()) {
  return [
    { id: 'ecommerce-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceGridApiDocument(snapshot = buildEcommerceGridSnapshot()) {
  return {
    id: 'ecommerce-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-grid/overview' },
      { method: 'GET', path: '/api/ecommerce-grid/reporting' },
      { method: 'POST', path: '/api/ecommerce-grid/validate' },
      { method: 'GET', path: '/api/ecommerce-grid/audit' }
    ],
    readiness: createEcommerceGridReadinessBoard(snapshot)
  };
}

export function createEcommerceGridRouteSummary(snapshot = buildEcommerceGridSnapshot()) {
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

