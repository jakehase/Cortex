import { createContentIndexWorkspace, summarizeContentIndexWorkspace, createContentIndexNarratives, createContentIndexCoverageGrid } from './domain-content-index.mjs';
import { createContentIndexPolicies, validateContentIndexPolicies, summarizeContentIndexPolicies, createContentIndexEscalationDeck } from './policies-content-index.mjs';
import { createContentIndexAnalyticsTimeline, createContentIndexForecastEnvelope, createContentIndexExceptionLedger, summarizeContentIndexAnalytics } from './analytics-content-index.mjs';
import { createContentIndexOperationsBoard, createContentIndexShiftChecklist, createContentIndexIncidentDeck } from './operations-content-index.mjs';
import { createContentIndexReportCards, createContentIndexReviewPackets, summarizeContentIndexReporting } from './reporting-content-index.mjs';
import { createContentIndexAuditTrail, createContentIndexEvidenceManifest, createContentIndexReadinessAttestation } from './audit-content-index.mjs';
import { createContentIndexPlaybooks, createContentIndexDecisionDeck, createContentIndexEscalationMoments } from './playbooks-content-index.mjs';

export function buildContentIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentIndexWorkspace(workspaceName);
  const policies = createContentIndexPolicies();
  return {
    workspace,
    summary: summarizeContentIndexWorkspace(workspace),
    narratives: createContentIndexNarratives(workspace),
    coverage: createContentIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentIndexPolicies(policies),
    validation: validateContentIndexPolicies(policies),
    escalationDeck: createContentIndexEscalationDeck(policies),
    analytics: {
      timeline: createContentIndexAnalyticsTimeline(),
      forecast: createContentIndexForecastEnvelope(),
      exceptions: createContentIndexExceptionLedger(),
      summary: summarizeContentIndexAnalytics()
    },
    operations: {
      board: createContentIndexOperationsBoard(),
      checklist: createContentIndexShiftChecklist(),
      incidents: createContentIndexIncidentDeck()
    },
    reporting: {
      cards: createContentIndexReportCards(),
      packets: createContentIndexReviewPackets(),
      summary: summarizeContentIndexReporting()
    },
    audit: {
      trail: createContentIndexAuditTrail(),
      manifest: createContentIndexEvidenceManifest(),
      attestation: createContentIndexReadinessAttestation()
    },
    playbooks: createContentIndexPlaybooks(),
    decisions: createContentIndexDecisionDeck(),
    escalationMoments: createContentIndexEscalationMoments()
  };
}

export function createContentIndexReadinessBoard(snapshot = buildContentIndexSnapshot()) {
  return [
    { id: 'content-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentIndexApiDocument(snapshot = buildContentIndexSnapshot()) {
  return {
    id: 'content-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-index/overview' },
      { method: 'GET', path: '/api/content-index/reporting' },
      { method: 'POST', path: '/api/content-index/validate' },
      { method: 'GET', path: '/api/content-index/audit' }
    ],
    readiness: createContentIndexReadinessBoard(snapshot)
  };
}

export function createContentIndexRouteSummary(snapshot = buildContentIndexSnapshot()) {
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

