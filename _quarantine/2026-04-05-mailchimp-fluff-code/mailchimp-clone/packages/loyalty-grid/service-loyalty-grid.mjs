import { createLoyaltyGridWorkspace, summarizeLoyaltyGridWorkspace, createLoyaltyGridNarratives, createLoyaltyGridCoverageGrid } from './domain-loyalty-grid.mjs';
import { createLoyaltyGridPolicies, validateLoyaltyGridPolicies, summarizeLoyaltyGridPolicies, createLoyaltyGridEscalationDeck } from './policies-loyalty-grid.mjs';
import { createLoyaltyGridAnalyticsTimeline, createLoyaltyGridForecastEnvelope, createLoyaltyGridExceptionLedger, summarizeLoyaltyGridAnalytics } from './analytics-loyalty-grid.mjs';
import { createLoyaltyGridOperationsBoard, createLoyaltyGridShiftChecklist, createLoyaltyGridIncidentDeck } from './operations-loyalty-grid.mjs';
import { createLoyaltyGridReportCards, createLoyaltyGridReviewPackets, summarizeLoyaltyGridReporting } from './reporting-loyalty-grid.mjs';
import { createLoyaltyGridAuditTrail, createLoyaltyGridEvidenceManifest, createLoyaltyGridReadinessAttestation } from './audit-loyalty-grid.mjs';
import { createLoyaltyGridPlaybooks, createLoyaltyGridDecisionDeck, createLoyaltyGridEscalationMoments } from './playbooks-loyalty-grid.mjs';

export function buildLoyaltyGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyGridWorkspace(workspaceName);
  const policies = createLoyaltyGridPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyGridWorkspace(workspace),
    narratives: createLoyaltyGridNarratives(workspace),
    coverage: createLoyaltyGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyGridPolicies(policies),
    validation: validateLoyaltyGridPolicies(policies),
    escalationDeck: createLoyaltyGridEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyGridAnalyticsTimeline(),
      forecast: createLoyaltyGridForecastEnvelope(),
      exceptions: createLoyaltyGridExceptionLedger(),
      summary: summarizeLoyaltyGridAnalytics()
    },
    operations: {
      board: createLoyaltyGridOperationsBoard(),
      checklist: createLoyaltyGridShiftChecklist(),
      incidents: createLoyaltyGridIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyGridReportCards(),
      packets: createLoyaltyGridReviewPackets(),
      summary: summarizeLoyaltyGridReporting()
    },
    audit: {
      trail: createLoyaltyGridAuditTrail(),
      manifest: createLoyaltyGridEvidenceManifest(),
      attestation: createLoyaltyGridReadinessAttestation()
    },
    playbooks: createLoyaltyGridPlaybooks(),
    decisions: createLoyaltyGridDecisionDeck(),
    escalationMoments: createLoyaltyGridEscalationMoments()
  };
}

export function createLoyaltyGridReadinessBoard(snapshot = buildLoyaltyGridSnapshot()) {
  return [
    { id: 'loyalty-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyGridApiDocument(snapshot = buildLoyaltyGridSnapshot()) {
  return {
    id: 'loyalty-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-grid/overview' },
      { method: 'GET', path: '/api/loyalty-grid/reporting' },
      { method: 'POST', path: '/api/loyalty-grid/validate' },
      { method: 'GET', path: '/api/loyalty-grid/audit' }
    ],
    readiness: createLoyaltyGridReadinessBoard(snapshot)
  };
}

export function createLoyaltyGridRouteSummary(snapshot = buildLoyaltyGridSnapshot()) {
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

