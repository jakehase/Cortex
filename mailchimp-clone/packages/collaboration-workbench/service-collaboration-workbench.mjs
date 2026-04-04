import { createCollaborationWorkbenchWorkspace, summarizeCollaborationWorkbenchWorkspace, createCollaborationWorkbenchNarratives, createCollaborationWorkbenchCoverageGrid } from './domain-collaboration-workbench.mjs';
import { createCollaborationWorkbenchPolicies, validateCollaborationWorkbenchPolicies, summarizeCollaborationWorkbenchPolicies, createCollaborationWorkbenchEscalationDeck } from './policies-collaboration-workbench.mjs';
import { createCollaborationWorkbenchAnalyticsTimeline, createCollaborationWorkbenchForecastEnvelope, createCollaborationWorkbenchExceptionLedger, summarizeCollaborationWorkbenchAnalytics } from './analytics-collaboration-workbench.mjs';
import { createCollaborationWorkbenchOperationsBoard, createCollaborationWorkbenchShiftChecklist, createCollaborationWorkbenchIncidentDeck } from './operations-collaboration-workbench.mjs';
import { createCollaborationWorkbenchReportCards, createCollaborationWorkbenchReviewPackets, summarizeCollaborationWorkbenchReporting } from './reporting-collaboration-workbench.mjs';
import { createCollaborationWorkbenchAuditTrail, createCollaborationWorkbenchEvidenceManifest, createCollaborationWorkbenchReadinessAttestation } from './audit-collaboration-workbench.mjs';
import { createCollaborationWorkbenchPlaybooks, createCollaborationWorkbenchDecisionDeck, createCollaborationWorkbenchEscalationMoments } from './playbooks-collaboration-workbench.mjs';

export function buildCollaborationWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationWorkbenchWorkspace(workspaceName);
  const policies = createCollaborationWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeCollaborationWorkbenchWorkspace(workspace),
    narratives: createCollaborationWorkbenchNarratives(workspace),
    coverage: createCollaborationWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationWorkbenchPolicies(policies),
    validation: validateCollaborationWorkbenchPolicies(policies),
    escalationDeck: createCollaborationWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationWorkbenchAnalyticsTimeline(),
      forecast: createCollaborationWorkbenchForecastEnvelope(),
      exceptions: createCollaborationWorkbenchExceptionLedger(),
      summary: summarizeCollaborationWorkbenchAnalytics()
    },
    operations: {
      board: createCollaborationWorkbenchOperationsBoard(),
      checklist: createCollaborationWorkbenchShiftChecklist(),
      incidents: createCollaborationWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createCollaborationWorkbenchReportCards(),
      packets: createCollaborationWorkbenchReviewPackets(),
      summary: summarizeCollaborationWorkbenchReporting()
    },
    audit: {
      trail: createCollaborationWorkbenchAuditTrail(),
      manifest: createCollaborationWorkbenchEvidenceManifest(),
      attestation: createCollaborationWorkbenchReadinessAttestation()
    },
    playbooks: createCollaborationWorkbenchPlaybooks(),
    decisions: createCollaborationWorkbenchDecisionDeck(),
    escalationMoments: createCollaborationWorkbenchEscalationMoments()
  };
}

export function createCollaborationWorkbenchReadinessBoard(snapshot = buildCollaborationWorkbenchSnapshot()) {
  return [
    { id: 'collaboration-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationWorkbenchApiDocument(snapshot = buildCollaborationWorkbenchSnapshot()) {
  return {
    id: 'collaboration-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-workbench/overview' },
      { method: 'GET', path: '/api/collaboration-workbench/reporting' },
      { method: 'POST', path: '/api/collaboration-workbench/validate' },
      { method: 'GET', path: '/api/collaboration-workbench/audit' }
    ],
    readiness: createCollaborationWorkbenchReadinessBoard(snapshot)
  };
}

export function createCollaborationWorkbenchRouteSummary(snapshot = buildCollaborationWorkbenchSnapshot()) {
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

