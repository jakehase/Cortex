import { createCollaborationHubWorkspace, summarizeCollaborationHubWorkspace, createCollaborationHubNarratives, createCollaborationHubCoverageGrid } from './domain-collaboration-hub.mjs';
import { createCollaborationHubPolicies, validateCollaborationHubPolicies, summarizeCollaborationHubPolicies, createCollaborationHubEscalationDeck } from './policies-collaboration-hub.mjs';
import { createCollaborationHubAnalyticsTimeline, createCollaborationHubForecastEnvelope, createCollaborationHubExceptionLedger, summarizeCollaborationHubAnalytics } from './analytics-collaboration-hub.mjs';
import { createCollaborationHubOperationsBoard, createCollaborationHubShiftChecklist, createCollaborationHubIncidentDeck } from './operations-collaboration-hub.mjs';
import { createCollaborationHubReportCards, createCollaborationHubReviewPackets, summarizeCollaborationHubReporting } from './reporting-collaboration-hub.mjs';
import { createCollaborationHubAuditTrail, createCollaborationHubEvidenceManifest, createCollaborationHubReadinessAttestation } from './audit-collaboration-hub.mjs';
import { createCollaborationHubPlaybooks, createCollaborationHubDecisionDeck, createCollaborationHubEscalationMoments } from './playbooks-collaboration-hub.mjs';

export function buildCollaborationHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationHubWorkspace(workspaceName);
  const policies = createCollaborationHubPolicies();
  return {
    workspace,
    summary: summarizeCollaborationHubWorkspace(workspace),
    narratives: createCollaborationHubNarratives(workspace),
    coverage: createCollaborationHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationHubPolicies(policies),
    validation: validateCollaborationHubPolicies(policies),
    escalationDeck: createCollaborationHubEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationHubAnalyticsTimeline(),
      forecast: createCollaborationHubForecastEnvelope(),
      exceptions: createCollaborationHubExceptionLedger(),
      summary: summarizeCollaborationHubAnalytics()
    },
    operations: {
      board: createCollaborationHubOperationsBoard(),
      checklist: createCollaborationHubShiftChecklist(),
      incidents: createCollaborationHubIncidentDeck()
    },
    reporting: {
      cards: createCollaborationHubReportCards(),
      packets: createCollaborationHubReviewPackets(),
      summary: summarizeCollaborationHubReporting()
    },
    audit: {
      trail: createCollaborationHubAuditTrail(),
      manifest: createCollaborationHubEvidenceManifest(),
      attestation: createCollaborationHubReadinessAttestation()
    },
    playbooks: createCollaborationHubPlaybooks(),
    decisions: createCollaborationHubDecisionDeck(),
    escalationMoments: createCollaborationHubEscalationMoments()
  };
}

export function createCollaborationHubReadinessBoard(snapshot = buildCollaborationHubSnapshot()) {
  return [
    { id: 'collaboration-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationHubApiDocument(snapshot = buildCollaborationHubSnapshot()) {
  return {
    id: 'collaboration-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-hub/overview' },
      { method: 'GET', path: '/api/collaboration-hub/reporting' },
      { method: 'POST', path: '/api/collaboration-hub/validate' },
      { method: 'GET', path: '/api/collaboration-hub/audit' }
    ],
    readiness: createCollaborationHubReadinessBoard(snapshot)
  };
}

export function createCollaborationHubRouteSummary(snapshot = buildCollaborationHubSnapshot()) {
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

