import { createBillingIndexWorkspace, summarizeBillingIndexWorkspace, createBillingIndexNarratives, createBillingIndexCoverageGrid } from './domain-billing-index.mjs';
import { createBillingIndexPolicies, validateBillingIndexPolicies, summarizeBillingIndexPolicies, createBillingIndexEscalationDeck } from './policies-billing-index.mjs';
import { createBillingIndexAnalyticsTimeline, createBillingIndexForecastEnvelope, createBillingIndexExceptionLedger, summarizeBillingIndexAnalytics } from './analytics-billing-index.mjs';
import { createBillingIndexOperationsBoard, createBillingIndexShiftChecklist, createBillingIndexIncidentDeck } from './operations-billing-index.mjs';
import { createBillingIndexReportCards, createBillingIndexReviewPackets, summarizeBillingIndexReporting } from './reporting-billing-index.mjs';
import { createBillingIndexAuditTrail, createBillingIndexEvidenceManifest, createBillingIndexReadinessAttestation } from './audit-billing-index.mjs';
import { createBillingIndexPlaybooks, createBillingIndexDecisionDeck, createBillingIndexEscalationMoments } from './playbooks-billing-index.mjs';

export function buildBillingIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingIndexWorkspace(workspaceName);
  const policies = createBillingIndexPolicies();
  return {
    workspace,
    summary: summarizeBillingIndexWorkspace(workspace),
    narratives: createBillingIndexNarratives(workspace),
    coverage: createBillingIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingIndexPolicies(policies),
    validation: validateBillingIndexPolicies(policies),
    escalationDeck: createBillingIndexEscalationDeck(policies),
    analytics: {
      timeline: createBillingIndexAnalyticsTimeline(),
      forecast: createBillingIndexForecastEnvelope(),
      exceptions: createBillingIndexExceptionLedger(),
      summary: summarizeBillingIndexAnalytics()
    },
    operations: {
      board: createBillingIndexOperationsBoard(),
      checklist: createBillingIndexShiftChecklist(),
      incidents: createBillingIndexIncidentDeck()
    },
    reporting: {
      cards: createBillingIndexReportCards(),
      packets: createBillingIndexReviewPackets(),
      summary: summarizeBillingIndexReporting()
    },
    audit: {
      trail: createBillingIndexAuditTrail(),
      manifest: createBillingIndexEvidenceManifest(),
      attestation: createBillingIndexReadinessAttestation()
    },
    playbooks: createBillingIndexPlaybooks(),
    decisions: createBillingIndexDecisionDeck(),
    escalationMoments: createBillingIndexEscalationMoments()
  };
}

export function createBillingIndexReadinessBoard(snapshot = buildBillingIndexSnapshot()) {
  return [
    { id: 'billing-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingIndexApiDocument(snapshot = buildBillingIndexSnapshot()) {
  return {
    id: 'billing-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-index/overview' },
      { method: 'GET', path: '/api/billing-index/reporting' },
      { method: 'POST', path: '/api/billing-index/validate' },
      { method: 'GET', path: '/api/billing-index/audit' }
    ],
    readiness: createBillingIndexReadinessBoard(snapshot)
  };
}

export function createBillingIndexRouteSummary(snapshot = buildBillingIndexSnapshot()) {
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

