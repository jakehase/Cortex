import { createAcquisitionGridWorkspace, summarizeAcquisitionGridWorkspace, createAcquisitionGridNarratives, createAcquisitionGridCoverageGrid } from './domain-acquisition-grid.mjs';
import { createAcquisitionGridPolicies, validateAcquisitionGridPolicies, summarizeAcquisitionGridPolicies, createAcquisitionGridEscalationDeck } from './policies-acquisition-grid.mjs';
import { createAcquisitionGridAnalyticsTimeline, createAcquisitionGridForecastEnvelope, createAcquisitionGridExceptionLedger, summarizeAcquisitionGridAnalytics } from './analytics-acquisition-grid.mjs';
import { createAcquisitionGridOperationsBoard, createAcquisitionGridShiftChecklist, createAcquisitionGridIncidentDeck } from './operations-acquisition-grid.mjs';
import { createAcquisitionGridReportCards, createAcquisitionGridReviewPackets, summarizeAcquisitionGridReporting } from './reporting-acquisition-grid.mjs';
import { createAcquisitionGridAuditTrail, createAcquisitionGridEvidenceManifest, createAcquisitionGridReadinessAttestation } from './audit-acquisition-grid.mjs';
import { createAcquisitionGridPlaybooks, createAcquisitionGridDecisionDeck, createAcquisitionGridEscalationMoments } from './playbooks-acquisition-grid.mjs';

export function buildAcquisitionGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionGridWorkspace(workspaceName);
  const policies = createAcquisitionGridPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionGridWorkspace(workspace),
    narratives: createAcquisitionGridNarratives(workspace),
    coverage: createAcquisitionGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionGridPolicies(policies),
    validation: validateAcquisitionGridPolicies(policies),
    escalationDeck: createAcquisitionGridEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionGridAnalyticsTimeline(),
      forecast: createAcquisitionGridForecastEnvelope(),
      exceptions: createAcquisitionGridExceptionLedger(),
      summary: summarizeAcquisitionGridAnalytics()
    },
    operations: {
      board: createAcquisitionGridOperationsBoard(),
      checklist: createAcquisitionGridShiftChecklist(),
      incidents: createAcquisitionGridIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionGridReportCards(),
      packets: createAcquisitionGridReviewPackets(),
      summary: summarizeAcquisitionGridReporting()
    },
    audit: {
      trail: createAcquisitionGridAuditTrail(),
      manifest: createAcquisitionGridEvidenceManifest(),
      attestation: createAcquisitionGridReadinessAttestation()
    },
    playbooks: createAcquisitionGridPlaybooks(),
    decisions: createAcquisitionGridDecisionDeck(),
    escalationMoments: createAcquisitionGridEscalationMoments()
  };
}

export function createAcquisitionGridReadinessBoard(snapshot = buildAcquisitionGridSnapshot()) {
  return [
    { id: 'acquisition-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionGridApiDocument(snapshot = buildAcquisitionGridSnapshot()) {
  return {
    id: 'acquisition-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-grid/overview' },
      { method: 'GET', path: '/api/acquisition-grid/reporting' },
      { method: 'POST', path: '/api/acquisition-grid/validate' },
      { method: 'GET', path: '/api/acquisition-grid/audit' }
    ],
    readiness: createAcquisitionGridReadinessBoard(snapshot)
  };
}

export function createAcquisitionGridRouteSummary(snapshot = buildAcquisitionGridSnapshot()) {
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

