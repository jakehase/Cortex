import { createAdvocacyGridWorkspace, summarizeAdvocacyGridWorkspace, createAdvocacyGridNarratives, createAdvocacyGridCoverageGrid } from './domain-advocacy-grid.mjs';
import { createAdvocacyGridPolicies, validateAdvocacyGridPolicies, summarizeAdvocacyGridPolicies, createAdvocacyGridEscalationDeck } from './policies-advocacy-grid.mjs';
import { createAdvocacyGridAnalyticsTimeline, createAdvocacyGridForecastEnvelope, createAdvocacyGridExceptionLedger, summarizeAdvocacyGridAnalytics } from './analytics-advocacy-grid.mjs';
import { createAdvocacyGridOperationsBoard, createAdvocacyGridShiftChecklist, createAdvocacyGridIncidentDeck } from './operations-advocacy-grid.mjs';
import { createAdvocacyGridReportCards, createAdvocacyGridReviewPackets, summarizeAdvocacyGridReporting } from './reporting-advocacy-grid.mjs';
import { createAdvocacyGridAuditTrail, createAdvocacyGridEvidenceManifest, createAdvocacyGridReadinessAttestation } from './audit-advocacy-grid.mjs';
import { createAdvocacyGridPlaybooks, createAdvocacyGridDecisionDeck, createAdvocacyGridEscalationMoments } from './playbooks-advocacy-grid.mjs';

export function buildAdvocacyGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyGridWorkspace(workspaceName);
  const policies = createAdvocacyGridPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyGridWorkspace(workspace),
    narratives: createAdvocacyGridNarratives(workspace),
    coverage: createAdvocacyGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyGridPolicies(policies),
    validation: validateAdvocacyGridPolicies(policies),
    escalationDeck: createAdvocacyGridEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyGridAnalyticsTimeline(),
      forecast: createAdvocacyGridForecastEnvelope(),
      exceptions: createAdvocacyGridExceptionLedger(),
      summary: summarizeAdvocacyGridAnalytics()
    },
    operations: {
      board: createAdvocacyGridOperationsBoard(),
      checklist: createAdvocacyGridShiftChecklist(),
      incidents: createAdvocacyGridIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyGridReportCards(),
      packets: createAdvocacyGridReviewPackets(),
      summary: summarizeAdvocacyGridReporting()
    },
    audit: {
      trail: createAdvocacyGridAuditTrail(),
      manifest: createAdvocacyGridEvidenceManifest(),
      attestation: createAdvocacyGridReadinessAttestation()
    },
    playbooks: createAdvocacyGridPlaybooks(),
    decisions: createAdvocacyGridDecisionDeck(),
    escalationMoments: createAdvocacyGridEscalationMoments()
  };
}

export function createAdvocacyGridReadinessBoard(snapshot = buildAdvocacyGridSnapshot()) {
  return [
    { id: 'advocacy-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyGridApiDocument(snapshot = buildAdvocacyGridSnapshot()) {
  return {
    id: 'advocacy-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-grid/overview' },
      { method: 'GET', path: '/api/advocacy-grid/reporting' },
      { method: 'POST', path: '/api/advocacy-grid/validate' },
      { method: 'GET', path: '/api/advocacy-grid/audit' }
    ],
    readiness: createAdvocacyGridReadinessBoard(snapshot)
  };
}

export function createAdvocacyGridRouteSummary(snapshot = buildAdvocacyGridSnapshot()) {
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

