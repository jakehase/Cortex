import { createCollaborationWatchtowerWorkspace, summarizeCollaborationWatchtowerWorkspace, createCollaborationWatchtowerNarratives, createCollaborationWatchtowerCoverageGrid } from './domain-collaboration-watchtower.mjs';
import { createCollaborationWatchtowerPolicies, validateCollaborationWatchtowerPolicies, summarizeCollaborationWatchtowerPolicies, createCollaborationWatchtowerEscalationDeck } from './policies-collaboration-watchtower.mjs';
import { createCollaborationWatchtowerAnalyticsTimeline, createCollaborationWatchtowerForecastEnvelope, createCollaborationWatchtowerExceptionLedger, summarizeCollaborationWatchtowerAnalytics } from './analytics-collaboration-watchtower.mjs';
import { createCollaborationWatchtowerOperationsBoard, createCollaborationWatchtowerShiftChecklist, createCollaborationWatchtowerIncidentDeck } from './operations-collaboration-watchtower.mjs';
import { createCollaborationWatchtowerReportCards, createCollaborationWatchtowerReviewPackets, summarizeCollaborationWatchtowerReporting } from './reporting-collaboration-watchtower.mjs';
import { createCollaborationWatchtowerAuditTrail, createCollaborationWatchtowerEvidenceManifest, createCollaborationWatchtowerReadinessAttestation } from './audit-collaboration-watchtower.mjs';
import { createCollaborationWatchtowerPlaybooks, createCollaborationWatchtowerDecisionDeck, createCollaborationWatchtowerEscalationMoments } from './playbooks-collaboration-watchtower.mjs';

export function buildCollaborationWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationWatchtowerWorkspace(workspaceName);
  const policies = createCollaborationWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeCollaborationWatchtowerWorkspace(workspace),
    narratives: createCollaborationWatchtowerNarratives(workspace),
    coverage: createCollaborationWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationWatchtowerPolicies(policies),
    validation: validateCollaborationWatchtowerPolicies(policies),
    escalationDeck: createCollaborationWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationWatchtowerAnalyticsTimeline(),
      forecast: createCollaborationWatchtowerForecastEnvelope(),
      exceptions: createCollaborationWatchtowerExceptionLedger(),
      summary: summarizeCollaborationWatchtowerAnalytics()
    },
    operations: {
      board: createCollaborationWatchtowerOperationsBoard(),
      checklist: createCollaborationWatchtowerShiftChecklist(),
      incidents: createCollaborationWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createCollaborationWatchtowerReportCards(),
      packets: createCollaborationWatchtowerReviewPackets(),
      summary: summarizeCollaborationWatchtowerReporting()
    },
    audit: {
      trail: createCollaborationWatchtowerAuditTrail(),
      manifest: createCollaborationWatchtowerEvidenceManifest(),
      attestation: createCollaborationWatchtowerReadinessAttestation()
    },
    playbooks: createCollaborationWatchtowerPlaybooks(),
    decisions: createCollaborationWatchtowerDecisionDeck(),
    escalationMoments: createCollaborationWatchtowerEscalationMoments()
  };
}

export function createCollaborationWatchtowerReadinessBoard(snapshot = buildCollaborationWatchtowerSnapshot()) {
  return [
    { id: 'collaboration-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationWatchtowerApiDocument(snapshot = buildCollaborationWatchtowerSnapshot()) {
  return {
    id: 'collaboration-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-watchtower/overview' },
      { method: 'GET', path: '/api/collaboration-watchtower/reporting' },
      { method: 'POST', path: '/api/collaboration-watchtower/validate' },
      { method: 'GET', path: '/api/collaboration-watchtower/audit' }
    ],
    readiness: createCollaborationWatchtowerReadinessBoard(snapshot)
  };
}

export function createCollaborationWatchtowerRouteSummary(snapshot = buildCollaborationWatchtowerSnapshot()) {
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

