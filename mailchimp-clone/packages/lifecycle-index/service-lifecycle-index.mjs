import { createLifecycleIndexWorkspace, summarizeLifecycleIndexWorkspace, createLifecycleIndexNarratives, createLifecycleIndexCoverageGrid } from './domain-lifecycle-index.mjs';
import { createLifecycleIndexPolicies, validateLifecycleIndexPolicies, summarizeLifecycleIndexPolicies, createLifecycleIndexEscalationDeck } from './policies-lifecycle-index.mjs';
import { createLifecycleIndexAnalyticsTimeline, createLifecycleIndexForecastEnvelope, createLifecycleIndexExceptionLedger, summarizeLifecycleIndexAnalytics } from './analytics-lifecycle-index.mjs';
import { createLifecycleIndexOperationsBoard, createLifecycleIndexShiftChecklist, createLifecycleIndexIncidentDeck } from './operations-lifecycle-index.mjs';
import { createLifecycleIndexReportCards, createLifecycleIndexReviewPackets, summarizeLifecycleIndexReporting } from './reporting-lifecycle-index.mjs';
import { createLifecycleIndexAuditTrail, createLifecycleIndexEvidenceManifest, createLifecycleIndexReadinessAttestation } from './audit-lifecycle-index.mjs';
import { createLifecycleIndexPlaybooks, createLifecycleIndexDecisionDeck, createLifecycleIndexEscalationMoments } from './playbooks-lifecycle-index.mjs';

export function buildLifecycleIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleIndexWorkspace(workspaceName);
  const policies = createLifecycleIndexPolicies();
  return {
    workspace,
    summary: summarizeLifecycleIndexWorkspace(workspace),
    narratives: createLifecycleIndexNarratives(workspace),
    coverage: createLifecycleIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleIndexPolicies(policies),
    validation: validateLifecycleIndexPolicies(policies),
    escalationDeck: createLifecycleIndexEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleIndexAnalyticsTimeline(),
      forecast: createLifecycleIndexForecastEnvelope(),
      exceptions: createLifecycleIndexExceptionLedger(),
      summary: summarizeLifecycleIndexAnalytics()
    },
    operations: {
      board: createLifecycleIndexOperationsBoard(),
      checklist: createLifecycleIndexShiftChecklist(),
      incidents: createLifecycleIndexIncidentDeck()
    },
    reporting: {
      cards: createLifecycleIndexReportCards(),
      packets: createLifecycleIndexReviewPackets(),
      summary: summarizeLifecycleIndexReporting()
    },
    audit: {
      trail: createLifecycleIndexAuditTrail(),
      manifest: createLifecycleIndexEvidenceManifest(),
      attestation: createLifecycleIndexReadinessAttestation()
    },
    playbooks: createLifecycleIndexPlaybooks(),
    decisions: createLifecycleIndexDecisionDeck(),
    escalationMoments: createLifecycleIndexEscalationMoments()
  };
}

export function createLifecycleIndexReadinessBoard(snapshot = buildLifecycleIndexSnapshot()) {
  return [
    { id: 'lifecycle-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleIndexApiDocument(snapshot = buildLifecycleIndexSnapshot()) {
  return {
    id: 'lifecycle-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-index/overview' },
      { method: 'GET', path: '/api/lifecycle-index/reporting' },
      { method: 'POST', path: '/api/lifecycle-index/validate' },
      { method: 'GET', path: '/api/lifecycle-index/audit' }
    ],
    readiness: createLifecycleIndexReadinessBoard(snapshot)
  };
}

export function createLifecycleIndexRouteSummary(snapshot = buildLifecycleIndexSnapshot()) {
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

