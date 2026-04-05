import { createExperimentationGridWorkspace, summarizeExperimentationGridWorkspace, createExperimentationGridNarratives, createExperimentationGridCoverageGrid } from './domain-experimentation-grid.mjs';
import { createExperimentationGridPolicies, validateExperimentationGridPolicies, summarizeExperimentationGridPolicies, createExperimentationGridEscalationDeck } from './policies-experimentation-grid.mjs';
import { createExperimentationGridAnalyticsTimeline, createExperimentationGridForecastEnvelope, createExperimentationGridExceptionLedger, summarizeExperimentationGridAnalytics } from './analytics-experimentation-grid.mjs';
import { createExperimentationGridOperationsBoard, createExperimentationGridShiftChecklist, createExperimentationGridIncidentDeck } from './operations-experimentation-grid.mjs';
import { createExperimentationGridReportCards, createExperimentationGridReviewPackets, summarizeExperimentationGridReporting } from './reporting-experimentation-grid.mjs';
import { createExperimentationGridAuditTrail, createExperimentationGridEvidenceManifest, createExperimentationGridReadinessAttestation } from './audit-experimentation-grid.mjs';
import { createExperimentationGridPlaybooks, createExperimentationGridDecisionDeck, createExperimentationGridEscalationMoments } from './playbooks-experimentation-grid.mjs';

export function buildExperimentationGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationGridWorkspace(workspaceName);
  const policies = createExperimentationGridPolicies();
  return {
    workspace,
    summary: summarizeExperimentationGridWorkspace(workspace),
    narratives: createExperimentationGridNarratives(workspace),
    coverage: createExperimentationGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationGridPolicies(policies),
    validation: validateExperimentationGridPolicies(policies),
    escalationDeck: createExperimentationGridEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationGridAnalyticsTimeline(),
      forecast: createExperimentationGridForecastEnvelope(),
      exceptions: createExperimentationGridExceptionLedger(),
      summary: summarizeExperimentationGridAnalytics()
    },
    operations: {
      board: createExperimentationGridOperationsBoard(),
      checklist: createExperimentationGridShiftChecklist(),
      incidents: createExperimentationGridIncidentDeck()
    },
    reporting: {
      cards: createExperimentationGridReportCards(),
      packets: createExperimentationGridReviewPackets(),
      summary: summarizeExperimentationGridReporting()
    },
    audit: {
      trail: createExperimentationGridAuditTrail(),
      manifest: createExperimentationGridEvidenceManifest(),
      attestation: createExperimentationGridReadinessAttestation()
    },
    playbooks: createExperimentationGridPlaybooks(),
    decisions: createExperimentationGridDecisionDeck(),
    escalationMoments: createExperimentationGridEscalationMoments()
  };
}

export function createExperimentationGridReadinessBoard(snapshot = buildExperimentationGridSnapshot()) {
  return [
    { id: 'experimentation-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationGridApiDocument(snapshot = buildExperimentationGridSnapshot()) {
  return {
    id: 'experimentation-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-grid/overview' },
      { method: 'GET', path: '/api/experimentation-grid/reporting' },
      { method: 'POST', path: '/api/experimentation-grid/validate' },
      { method: 'GET', path: '/api/experimentation-grid/audit' }
    ],
    readiness: createExperimentationGridReadinessBoard(snapshot)
  };
}

export function createExperimentationGridRouteSummary(snapshot = buildExperimentationGridSnapshot()) {
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

