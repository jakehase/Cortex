import { createCreativeIndexWorkspace, summarizeCreativeIndexWorkspace, createCreativeIndexNarratives, createCreativeIndexCoverageGrid } from './domain-creative-index.mjs';
import { createCreativeIndexPolicies, validateCreativeIndexPolicies, summarizeCreativeIndexPolicies, createCreativeIndexEscalationDeck } from './policies-creative-index.mjs';
import { createCreativeIndexAnalyticsTimeline, createCreativeIndexForecastEnvelope, createCreativeIndexExceptionLedger, summarizeCreativeIndexAnalytics } from './analytics-creative-index.mjs';
import { createCreativeIndexOperationsBoard, createCreativeIndexShiftChecklist, createCreativeIndexIncidentDeck } from './operations-creative-index.mjs';
import { createCreativeIndexReportCards, createCreativeIndexReviewPackets, summarizeCreativeIndexReporting } from './reporting-creative-index.mjs';
import { createCreativeIndexAuditTrail, createCreativeIndexEvidenceManifest, createCreativeIndexReadinessAttestation } from './audit-creative-index.mjs';
import { createCreativeIndexPlaybooks, createCreativeIndexDecisionDeck, createCreativeIndexEscalationMoments } from './playbooks-creative-index.mjs';

export function buildCreativeIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeIndexWorkspace(workspaceName);
  const policies = createCreativeIndexPolicies();
  return {
    workspace,
    summary: summarizeCreativeIndexWorkspace(workspace),
    narratives: createCreativeIndexNarratives(workspace),
    coverage: createCreativeIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeIndexPolicies(policies),
    validation: validateCreativeIndexPolicies(policies),
    escalationDeck: createCreativeIndexEscalationDeck(policies),
    analytics: {
      timeline: createCreativeIndexAnalyticsTimeline(),
      forecast: createCreativeIndexForecastEnvelope(),
      exceptions: createCreativeIndexExceptionLedger(),
      summary: summarizeCreativeIndexAnalytics()
    },
    operations: {
      board: createCreativeIndexOperationsBoard(),
      checklist: createCreativeIndexShiftChecklist(),
      incidents: createCreativeIndexIncidentDeck()
    },
    reporting: {
      cards: createCreativeIndexReportCards(),
      packets: createCreativeIndexReviewPackets(),
      summary: summarizeCreativeIndexReporting()
    },
    audit: {
      trail: createCreativeIndexAuditTrail(),
      manifest: createCreativeIndexEvidenceManifest(),
      attestation: createCreativeIndexReadinessAttestation()
    },
    playbooks: createCreativeIndexPlaybooks(),
    decisions: createCreativeIndexDecisionDeck(),
    escalationMoments: createCreativeIndexEscalationMoments()
  };
}

export function createCreativeIndexReadinessBoard(snapshot = buildCreativeIndexSnapshot()) {
  return [
    { id: 'creative-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeIndexApiDocument(snapshot = buildCreativeIndexSnapshot()) {
  return {
    id: 'creative-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-index/overview' },
      { method: 'GET', path: '/api/creative-index/reporting' },
      { method: 'POST', path: '/api/creative-index/validate' },
      { method: 'GET', path: '/api/creative-index/audit' }
    ],
    readiness: createCreativeIndexReadinessBoard(snapshot)
  };
}

export function createCreativeIndexRouteSummary(snapshot = buildCreativeIndexSnapshot()) {
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

