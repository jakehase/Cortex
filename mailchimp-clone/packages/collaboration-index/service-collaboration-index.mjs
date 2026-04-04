import { createCollaborationIndexWorkspace, summarizeCollaborationIndexWorkspace, createCollaborationIndexNarratives, createCollaborationIndexCoverageGrid } from './domain-collaboration-index.mjs';
import { createCollaborationIndexPolicies, validateCollaborationIndexPolicies, summarizeCollaborationIndexPolicies, createCollaborationIndexEscalationDeck } from './policies-collaboration-index.mjs';
import { createCollaborationIndexAnalyticsTimeline, createCollaborationIndexForecastEnvelope, createCollaborationIndexExceptionLedger, summarizeCollaborationIndexAnalytics } from './analytics-collaboration-index.mjs';
import { createCollaborationIndexOperationsBoard, createCollaborationIndexShiftChecklist, createCollaborationIndexIncidentDeck } from './operations-collaboration-index.mjs';
import { createCollaborationIndexReportCards, createCollaborationIndexReviewPackets, summarizeCollaborationIndexReporting } from './reporting-collaboration-index.mjs';
import { createCollaborationIndexAuditTrail, createCollaborationIndexEvidenceManifest, createCollaborationIndexReadinessAttestation } from './audit-collaboration-index.mjs';
import { createCollaborationIndexPlaybooks, createCollaborationIndexDecisionDeck, createCollaborationIndexEscalationMoments } from './playbooks-collaboration-index.mjs';

export function buildCollaborationIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationIndexWorkspace(workspaceName);
  const policies = createCollaborationIndexPolicies();
  return {
    workspace,
    summary: summarizeCollaborationIndexWorkspace(workspace),
    narratives: createCollaborationIndexNarratives(workspace),
    coverage: createCollaborationIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationIndexPolicies(policies),
    validation: validateCollaborationIndexPolicies(policies),
    escalationDeck: createCollaborationIndexEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationIndexAnalyticsTimeline(),
      forecast: createCollaborationIndexForecastEnvelope(),
      exceptions: createCollaborationIndexExceptionLedger(),
      summary: summarizeCollaborationIndexAnalytics()
    },
    operations: {
      board: createCollaborationIndexOperationsBoard(),
      checklist: createCollaborationIndexShiftChecklist(),
      incidents: createCollaborationIndexIncidentDeck()
    },
    reporting: {
      cards: createCollaborationIndexReportCards(),
      packets: createCollaborationIndexReviewPackets(),
      summary: summarizeCollaborationIndexReporting()
    },
    audit: {
      trail: createCollaborationIndexAuditTrail(),
      manifest: createCollaborationIndexEvidenceManifest(),
      attestation: createCollaborationIndexReadinessAttestation()
    },
    playbooks: createCollaborationIndexPlaybooks(),
    decisions: createCollaborationIndexDecisionDeck(),
    escalationMoments: createCollaborationIndexEscalationMoments()
  };
}

export function createCollaborationIndexReadinessBoard(snapshot = buildCollaborationIndexSnapshot()) {
  return [
    { id: 'collaboration-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationIndexApiDocument(snapshot = buildCollaborationIndexSnapshot()) {
  return {
    id: 'collaboration-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-index/overview' },
      { method: 'GET', path: '/api/collaboration-index/reporting' },
      { method: 'POST', path: '/api/collaboration-index/validate' },
      { method: 'GET', path: '/api/collaboration-index/audit' }
    ],
    readiness: createCollaborationIndexReadinessBoard(snapshot)
  };
}

export function createCollaborationIndexRouteSummary(snapshot = buildCollaborationIndexSnapshot()) {
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

