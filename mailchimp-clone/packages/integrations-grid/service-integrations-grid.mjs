import { createIntegrationsGridWorkspace, summarizeIntegrationsGridWorkspace, createIntegrationsGridNarratives, createIntegrationsGridCoverageGrid } from './domain-integrations-grid.mjs';
import { createIntegrationsGridPolicies, validateIntegrationsGridPolicies, summarizeIntegrationsGridPolicies, createIntegrationsGridEscalationDeck } from './policies-integrations-grid.mjs';
import { createIntegrationsGridAnalyticsTimeline, createIntegrationsGridForecastEnvelope, createIntegrationsGridExceptionLedger, summarizeIntegrationsGridAnalytics } from './analytics-integrations-grid.mjs';
import { createIntegrationsGridOperationsBoard, createIntegrationsGridShiftChecklist, createIntegrationsGridIncidentDeck } from './operations-integrations-grid.mjs';
import { createIntegrationsGridReportCards, createIntegrationsGridReviewPackets, summarizeIntegrationsGridReporting } from './reporting-integrations-grid.mjs';
import { createIntegrationsGridAuditTrail, createIntegrationsGridEvidenceManifest, createIntegrationsGridReadinessAttestation } from './audit-integrations-grid.mjs';
import { createIntegrationsGridPlaybooks, createIntegrationsGridDecisionDeck, createIntegrationsGridEscalationMoments } from './playbooks-integrations-grid.mjs';

export function buildIntegrationsGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsGridWorkspace(workspaceName);
  const policies = createIntegrationsGridPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsGridWorkspace(workspace),
    narratives: createIntegrationsGridNarratives(workspace),
    coverage: createIntegrationsGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsGridPolicies(policies),
    validation: validateIntegrationsGridPolicies(policies),
    escalationDeck: createIntegrationsGridEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsGridAnalyticsTimeline(),
      forecast: createIntegrationsGridForecastEnvelope(),
      exceptions: createIntegrationsGridExceptionLedger(),
      summary: summarizeIntegrationsGridAnalytics()
    },
    operations: {
      board: createIntegrationsGridOperationsBoard(),
      checklist: createIntegrationsGridShiftChecklist(),
      incidents: createIntegrationsGridIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsGridReportCards(),
      packets: createIntegrationsGridReviewPackets(),
      summary: summarizeIntegrationsGridReporting()
    },
    audit: {
      trail: createIntegrationsGridAuditTrail(),
      manifest: createIntegrationsGridEvidenceManifest(),
      attestation: createIntegrationsGridReadinessAttestation()
    },
    playbooks: createIntegrationsGridPlaybooks(),
    decisions: createIntegrationsGridDecisionDeck(),
    escalationMoments: createIntegrationsGridEscalationMoments()
  };
}

export function createIntegrationsGridReadinessBoard(snapshot = buildIntegrationsGridSnapshot()) {
  return [
    { id: 'integrations-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsGridApiDocument(snapshot = buildIntegrationsGridSnapshot()) {
  return {
    id: 'integrations-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-grid/overview' },
      { method: 'GET', path: '/api/integrations-grid/reporting' },
      { method: 'POST', path: '/api/integrations-grid/validate' },
      { method: 'GET', path: '/api/integrations-grid/audit' }
    ],
    readiness: createIntegrationsGridReadinessBoard(snapshot)
  };
}

export function createIntegrationsGridRouteSummary(snapshot = buildIntegrationsGridSnapshot()) {
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

