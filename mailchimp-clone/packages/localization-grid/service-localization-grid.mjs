import { createLocalizationGridWorkspace, summarizeLocalizationGridWorkspace, createLocalizationGridNarratives, createLocalizationGridCoverageGrid } from './domain-localization-grid.mjs';
import { createLocalizationGridPolicies, validateLocalizationGridPolicies, summarizeLocalizationGridPolicies, createLocalizationGridEscalationDeck } from './policies-localization-grid.mjs';
import { createLocalizationGridAnalyticsTimeline, createLocalizationGridForecastEnvelope, createLocalizationGridExceptionLedger, summarizeLocalizationGridAnalytics } from './analytics-localization-grid.mjs';
import { createLocalizationGridOperationsBoard, createLocalizationGridShiftChecklist, createLocalizationGridIncidentDeck } from './operations-localization-grid.mjs';
import { createLocalizationGridReportCards, createLocalizationGridReviewPackets, summarizeLocalizationGridReporting } from './reporting-localization-grid.mjs';
import { createLocalizationGridAuditTrail, createLocalizationGridEvidenceManifest, createLocalizationGridReadinessAttestation } from './audit-localization-grid.mjs';
import { createLocalizationGridPlaybooks, createLocalizationGridDecisionDeck, createLocalizationGridEscalationMoments } from './playbooks-localization-grid.mjs';

export function buildLocalizationGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationGridWorkspace(workspaceName);
  const policies = createLocalizationGridPolicies();
  return {
    workspace,
    summary: summarizeLocalizationGridWorkspace(workspace),
    narratives: createLocalizationGridNarratives(workspace),
    coverage: createLocalizationGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationGridPolicies(policies),
    validation: validateLocalizationGridPolicies(policies),
    escalationDeck: createLocalizationGridEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationGridAnalyticsTimeline(),
      forecast: createLocalizationGridForecastEnvelope(),
      exceptions: createLocalizationGridExceptionLedger(),
      summary: summarizeLocalizationGridAnalytics()
    },
    operations: {
      board: createLocalizationGridOperationsBoard(),
      checklist: createLocalizationGridShiftChecklist(),
      incidents: createLocalizationGridIncidentDeck()
    },
    reporting: {
      cards: createLocalizationGridReportCards(),
      packets: createLocalizationGridReviewPackets(),
      summary: summarizeLocalizationGridReporting()
    },
    audit: {
      trail: createLocalizationGridAuditTrail(),
      manifest: createLocalizationGridEvidenceManifest(),
      attestation: createLocalizationGridReadinessAttestation()
    },
    playbooks: createLocalizationGridPlaybooks(),
    decisions: createLocalizationGridDecisionDeck(),
    escalationMoments: createLocalizationGridEscalationMoments()
  };
}

export function createLocalizationGridReadinessBoard(snapshot = buildLocalizationGridSnapshot()) {
  return [
    { id: 'localization-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationGridApiDocument(snapshot = buildLocalizationGridSnapshot()) {
  return {
    id: 'localization-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-grid/overview' },
      { method: 'GET', path: '/api/localization-grid/reporting' },
      { method: 'POST', path: '/api/localization-grid/validate' },
      { method: 'GET', path: '/api/localization-grid/audit' }
    ],
    readiness: createLocalizationGridReadinessBoard(snapshot)
  };
}

export function createLocalizationGridRouteSummary(snapshot = buildLocalizationGridSnapshot()) {
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

