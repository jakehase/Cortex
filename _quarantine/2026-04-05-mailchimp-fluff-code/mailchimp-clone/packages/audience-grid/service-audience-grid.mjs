import { createAudienceGridWorkspace, summarizeAudienceGridWorkspace, createAudienceGridNarratives, createAudienceGridCoverageGrid } from './domain-audience-grid.mjs';
import { createAudienceGridPolicies, validateAudienceGridPolicies, summarizeAudienceGridPolicies, createAudienceGridEscalationDeck } from './policies-audience-grid.mjs';
import { createAudienceGridAnalyticsTimeline, createAudienceGridForecastEnvelope, createAudienceGridExceptionLedger, summarizeAudienceGridAnalytics } from './analytics-audience-grid.mjs';
import { createAudienceGridOperationsBoard, createAudienceGridShiftChecklist, createAudienceGridIncidentDeck } from './operations-audience-grid.mjs';
import { createAudienceGridReportCards, createAudienceGridReviewPackets, summarizeAudienceGridReporting } from './reporting-audience-grid.mjs';
import { createAudienceGridAuditTrail, createAudienceGridEvidenceManifest, createAudienceGridReadinessAttestation } from './audit-audience-grid.mjs';
import { createAudienceGridPlaybooks, createAudienceGridDecisionDeck, createAudienceGridEscalationMoments } from './playbooks-audience-grid.mjs';

export function buildAudienceGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceGridWorkspace(workspaceName);
  const policies = createAudienceGridPolicies();
  return {
    workspace,
    summary: summarizeAudienceGridWorkspace(workspace),
    narratives: createAudienceGridNarratives(workspace),
    coverage: createAudienceGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceGridPolicies(policies),
    validation: validateAudienceGridPolicies(policies),
    escalationDeck: createAudienceGridEscalationDeck(policies),
    analytics: {
      timeline: createAudienceGridAnalyticsTimeline(),
      forecast: createAudienceGridForecastEnvelope(),
      exceptions: createAudienceGridExceptionLedger(),
      summary: summarizeAudienceGridAnalytics()
    },
    operations: {
      board: createAudienceGridOperationsBoard(),
      checklist: createAudienceGridShiftChecklist(),
      incidents: createAudienceGridIncidentDeck()
    },
    reporting: {
      cards: createAudienceGridReportCards(),
      packets: createAudienceGridReviewPackets(),
      summary: summarizeAudienceGridReporting()
    },
    audit: {
      trail: createAudienceGridAuditTrail(),
      manifest: createAudienceGridEvidenceManifest(),
      attestation: createAudienceGridReadinessAttestation()
    },
    playbooks: createAudienceGridPlaybooks(),
    decisions: createAudienceGridDecisionDeck(),
    escalationMoments: createAudienceGridEscalationMoments()
  };
}

export function createAudienceGridReadinessBoard(snapshot = buildAudienceGridSnapshot()) {
  return [
    { id: 'audience-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceGridApiDocument(snapshot = buildAudienceGridSnapshot()) {
  return {
    id: 'audience-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-grid/overview' },
      { method: 'GET', path: '/api/audience-grid/reporting' },
      { method: 'POST', path: '/api/audience-grid/validate' },
      { method: 'GET', path: '/api/audience-grid/audit' }
    ],
    readiness: createAudienceGridReadinessBoard(snapshot)
  };
}

export function createAudienceGridRouteSummary(snapshot = buildAudienceGridSnapshot()) {
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

