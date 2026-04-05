import { createCommerceGridWorkspace, summarizeCommerceGridWorkspace, createCommerceGridNarratives, createCommerceGridCoverageGrid } from './domain-commerce-grid.mjs';
import { createCommerceGridPolicies, validateCommerceGridPolicies, summarizeCommerceGridPolicies, createCommerceGridEscalationDeck } from './policies-commerce-grid.mjs';
import { createCommerceGridAnalyticsTimeline, createCommerceGridForecastEnvelope, createCommerceGridExceptionLedger, summarizeCommerceGridAnalytics } from './analytics-commerce-grid.mjs';
import { createCommerceGridOperationsBoard, createCommerceGridShiftChecklist, createCommerceGridIncidentDeck } from './operations-commerce-grid.mjs';
import { createCommerceGridReportCards, createCommerceGridReviewPackets, summarizeCommerceGridReporting } from './reporting-commerce-grid.mjs';
import { createCommerceGridAuditTrail, createCommerceGridEvidenceManifest, createCommerceGridReadinessAttestation } from './audit-commerce-grid.mjs';
import { createCommerceGridPlaybooks, createCommerceGridDecisionDeck, createCommerceGridEscalationMoments } from './playbooks-commerce-grid.mjs';

export function buildCommerceGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceGridWorkspace(workspaceName);
  const policies = createCommerceGridPolicies();
  return {
    workspace,
    summary: summarizeCommerceGridWorkspace(workspace),
    narratives: createCommerceGridNarratives(workspace),
    coverage: createCommerceGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceGridPolicies(policies),
    validation: validateCommerceGridPolicies(policies),
    escalationDeck: createCommerceGridEscalationDeck(policies),
    analytics: {
      timeline: createCommerceGridAnalyticsTimeline(),
      forecast: createCommerceGridForecastEnvelope(),
      exceptions: createCommerceGridExceptionLedger(),
      summary: summarizeCommerceGridAnalytics()
    },
    operations: {
      board: createCommerceGridOperationsBoard(),
      checklist: createCommerceGridShiftChecklist(),
      incidents: createCommerceGridIncidentDeck()
    },
    reporting: {
      cards: createCommerceGridReportCards(),
      packets: createCommerceGridReviewPackets(),
      summary: summarizeCommerceGridReporting()
    },
    audit: {
      trail: createCommerceGridAuditTrail(),
      manifest: createCommerceGridEvidenceManifest(),
      attestation: createCommerceGridReadinessAttestation()
    },
    playbooks: createCommerceGridPlaybooks(),
    decisions: createCommerceGridDecisionDeck(),
    escalationMoments: createCommerceGridEscalationMoments()
  };
}

export function createCommerceGridReadinessBoard(snapshot = buildCommerceGridSnapshot()) {
  return [
    { id: 'commerce-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceGridApiDocument(snapshot = buildCommerceGridSnapshot()) {
  return {
    id: 'commerce-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-grid/overview' },
      { method: 'GET', path: '/api/commerce-grid/reporting' },
      { method: 'POST', path: '/api/commerce-grid/validate' },
      { method: 'GET', path: '/api/commerce-grid/audit' }
    ],
    readiness: createCommerceGridReadinessBoard(snapshot)
  };
}

export function createCommerceGridRouteSummary(snapshot = buildCommerceGridSnapshot()) {
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

