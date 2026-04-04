import { createCollaborationGridWorkspace, summarizeCollaborationGridWorkspace, createCollaborationGridNarratives, createCollaborationGridCoverageGrid } from './domain-collaboration-grid.mjs';
import { createCollaborationGridPolicies, validateCollaborationGridPolicies, summarizeCollaborationGridPolicies, createCollaborationGridEscalationDeck } from './policies-collaboration-grid.mjs';
import { createCollaborationGridAnalyticsTimeline, createCollaborationGridForecastEnvelope, createCollaborationGridExceptionLedger, summarizeCollaborationGridAnalytics } from './analytics-collaboration-grid.mjs';
import { createCollaborationGridOperationsBoard, createCollaborationGridShiftChecklist, createCollaborationGridIncidentDeck } from './operations-collaboration-grid.mjs';
import { createCollaborationGridReportCards, createCollaborationGridReviewPackets, summarizeCollaborationGridReporting } from './reporting-collaboration-grid.mjs';
import { createCollaborationGridAuditTrail, createCollaborationGridEvidenceManifest, createCollaborationGridReadinessAttestation } from './audit-collaboration-grid.mjs';
import { createCollaborationGridPlaybooks, createCollaborationGridDecisionDeck, createCollaborationGridEscalationMoments } from './playbooks-collaboration-grid.mjs';

export function buildCollaborationGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationGridWorkspace(workspaceName);
  const policies = createCollaborationGridPolicies();
  return {
    workspace,
    summary: summarizeCollaborationGridWorkspace(workspace),
    narratives: createCollaborationGridNarratives(workspace),
    coverage: createCollaborationGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationGridPolicies(policies),
    validation: validateCollaborationGridPolicies(policies),
    escalationDeck: createCollaborationGridEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationGridAnalyticsTimeline(),
      forecast: createCollaborationGridForecastEnvelope(),
      exceptions: createCollaborationGridExceptionLedger(),
      summary: summarizeCollaborationGridAnalytics()
    },
    operations: {
      board: createCollaborationGridOperationsBoard(),
      checklist: createCollaborationGridShiftChecklist(),
      incidents: createCollaborationGridIncidentDeck()
    },
    reporting: {
      cards: createCollaborationGridReportCards(),
      packets: createCollaborationGridReviewPackets(),
      summary: summarizeCollaborationGridReporting()
    },
    audit: {
      trail: createCollaborationGridAuditTrail(),
      manifest: createCollaborationGridEvidenceManifest(),
      attestation: createCollaborationGridReadinessAttestation()
    },
    playbooks: createCollaborationGridPlaybooks(),
    decisions: createCollaborationGridDecisionDeck(),
    escalationMoments: createCollaborationGridEscalationMoments()
  };
}

export function createCollaborationGridReadinessBoard(snapshot = buildCollaborationGridSnapshot()) {
  return [
    { id: 'collaboration-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationGridApiDocument(snapshot = buildCollaborationGridSnapshot()) {
  return {
    id: 'collaboration-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-grid/overview' },
      { method: 'GET', path: '/api/collaboration-grid/reporting' },
      { method: 'POST', path: '/api/collaboration-grid/validate' },
      { method: 'GET', path: '/api/collaboration-grid/audit' }
    ],
    readiness: createCollaborationGridReadinessBoard(snapshot)
  };
}

export function createCollaborationGridRouteSummary(snapshot = buildCollaborationGridSnapshot()) {
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

