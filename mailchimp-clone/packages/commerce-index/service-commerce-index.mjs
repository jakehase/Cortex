import { createCommerceIndexWorkspace, summarizeCommerceIndexWorkspace, createCommerceIndexNarratives, createCommerceIndexCoverageGrid } from './domain-commerce-index.mjs';
import { createCommerceIndexPolicies, validateCommerceIndexPolicies, summarizeCommerceIndexPolicies, createCommerceIndexEscalationDeck } from './policies-commerce-index.mjs';
import { createCommerceIndexAnalyticsTimeline, createCommerceIndexForecastEnvelope, createCommerceIndexExceptionLedger, summarizeCommerceIndexAnalytics } from './analytics-commerce-index.mjs';
import { createCommerceIndexOperationsBoard, createCommerceIndexShiftChecklist, createCommerceIndexIncidentDeck } from './operations-commerce-index.mjs';
import { createCommerceIndexReportCards, createCommerceIndexReviewPackets, summarizeCommerceIndexReporting } from './reporting-commerce-index.mjs';
import { createCommerceIndexAuditTrail, createCommerceIndexEvidenceManifest, createCommerceIndexReadinessAttestation } from './audit-commerce-index.mjs';
import { createCommerceIndexPlaybooks, createCommerceIndexDecisionDeck, createCommerceIndexEscalationMoments } from './playbooks-commerce-index.mjs';

export function buildCommerceIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceIndexWorkspace(workspaceName);
  const policies = createCommerceIndexPolicies();
  return {
    workspace,
    summary: summarizeCommerceIndexWorkspace(workspace),
    narratives: createCommerceIndexNarratives(workspace),
    coverage: createCommerceIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceIndexPolicies(policies),
    validation: validateCommerceIndexPolicies(policies),
    escalationDeck: createCommerceIndexEscalationDeck(policies),
    analytics: {
      timeline: createCommerceIndexAnalyticsTimeline(),
      forecast: createCommerceIndexForecastEnvelope(),
      exceptions: createCommerceIndexExceptionLedger(),
      summary: summarizeCommerceIndexAnalytics()
    },
    operations: {
      board: createCommerceIndexOperationsBoard(),
      checklist: createCommerceIndexShiftChecklist(),
      incidents: createCommerceIndexIncidentDeck()
    },
    reporting: {
      cards: createCommerceIndexReportCards(),
      packets: createCommerceIndexReviewPackets(),
      summary: summarizeCommerceIndexReporting()
    },
    audit: {
      trail: createCommerceIndexAuditTrail(),
      manifest: createCommerceIndexEvidenceManifest(),
      attestation: createCommerceIndexReadinessAttestation()
    },
    playbooks: createCommerceIndexPlaybooks(),
    decisions: createCommerceIndexDecisionDeck(),
    escalationMoments: createCommerceIndexEscalationMoments()
  };
}

export function createCommerceIndexReadinessBoard(snapshot = buildCommerceIndexSnapshot()) {
  return [
    { id: 'commerce-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceIndexApiDocument(snapshot = buildCommerceIndexSnapshot()) {
  return {
    id: 'commerce-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-index/overview' },
      { method: 'GET', path: '/api/commerce-index/reporting' },
      { method: 'POST', path: '/api/commerce-index/validate' },
      { method: 'GET', path: '/api/commerce-index/audit' }
    ],
    readiness: createCommerceIndexReadinessBoard(snapshot)
  };
}

export function createCommerceIndexRouteSummary(snapshot = buildCommerceIndexSnapshot()) {
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

