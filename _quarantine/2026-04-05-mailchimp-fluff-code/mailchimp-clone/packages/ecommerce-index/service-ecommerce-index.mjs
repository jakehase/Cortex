import { createEcommerceIndexWorkspace, summarizeEcommerceIndexWorkspace, createEcommerceIndexNarratives, createEcommerceIndexCoverageGrid } from './domain-ecommerce-index.mjs';
import { createEcommerceIndexPolicies, validateEcommerceIndexPolicies, summarizeEcommerceIndexPolicies, createEcommerceIndexEscalationDeck } from './policies-ecommerce-index.mjs';
import { createEcommerceIndexAnalyticsTimeline, createEcommerceIndexForecastEnvelope, createEcommerceIndexExceptionLedger, summarizeEcommerceIndexAnalytics } from './analytics-ecommerce-index.mjs';
import { createEcommerceIndexOperationsBoard, createEcommerceIndexShiftChecklist, createEcommerceIndexIncidentDeck } from './operations-ecommerce-index.mjs';
import { createEcommerceIndexReportCards, createEcommerceIndexReviewPackets, summarizeEcommerceIndexReporting } from './reporting-ecommerce-index.mjs';
import { createEcommerceIndexAuditTrail, createEcommerceIndexEvidenceManifest, createEcommerceIndexReadinessAttestation } from './audit-ecommerce-index.mjs';
import { createEcommerceIndexPlaybooks, createEcommerceIndexDecisionDeck, createEcommerceIndexEscalationMoments } from './playbooks-ecommerce-index.mjs';

export function buildEcommerceIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceIndexWorkspace(workspaceName);
  const policies = createEcommerceIndexPolicies();
  return {
    workspace,
    summary: summarizeEcommerceIndexWorkspace(workspace),
    narratives: createEcommerceIndexNarratives(workspace),
    coverage: createEcommerceIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceIndexPolicies(policies),
    validation: validateEcommerceIndexPolicies(policies),
    escalationDeck: createEcommerceIndexEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceIndexAnalyticsTimeline(),
      forecast: createEcommerceIndexForecastEnvelope(),
      exceptions: createEcommerceIndexExceptionLedger(),
      summary: summarizeEcommerceIndexAnalytics()
    },
    operations: {
      board: createEcommerceIndexOperationsBoard(),
      checklist: createEcommerceIndexShiftChecklist(),
      incidents: createEcommerceIndexIncidentDeck()
    },
    reporting: {
      cards: createEcommerceIndexReportCards(),
      packets: createEcommerceIndexReviewPackets(),
      summary: summarizeEcommerceIndexReporting()
    },
    audit: {
      trail: createEcommerceIndexAuditTrail(),
      manifest: createEcommerceIndexEvidenceManifest(),
      attestation: createEcommerceIndexReadinessAttestation()
    },
    playbooks: createEcommerceIndexPlaybooks(),
    decisions: createEcommerceIndexDecisionDeck(),
    escalationMoments: createEcommerceIndexEscalationMoments()
  };
}

export function createEcommerceIndexReadinessBoard(snapshot = buildEcommerceIndexSnapshot()) {
  return [
    { id: 'ecommerce-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceIndexApiDocument(snapshot = buildEcommerceIndexSnapshot()) {
  return {
    id: 'ecommerce-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-index/overview' },
      { method: 'GET', path: '/api/ecommerce-index/reporting' },
      { method: 'POST', path: '/api/ecommerce-index/validate' },
      { method: 'GET', path: '/api/ecommerce-index/audit' }
    ],
    readiness: createEcommerceIndexReadinessBoard(snapshot)
  };
}

export function createEcommerceIndexRouteSummary(snapshot = buildEcommerceIndexSnapshot()) {
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

