import { createCustomerIndexWorkspace, summarizeCustomerIndexWorkspace, createCustomerIndexNarratives, createCustomerIndexCoverageGrid } from './domain-customer-index.mjs';
import { createCustomerIndexPolicies, validateCustomerIndexPolicies, summarizeCustomerIndexPolicies, createCustomerIndexEscalationDeck } from './policies-customer-index.mjs';
import { createCustomerIndexAnalyticsTimeline, createCustomerIndexForecastEnvelope, createCustomerIndexExceptionLedger, summarizeCustomerIndexAnalytics } from './analytics-customer-index.mjs';
import { createCustomerIndexOperationsBoard, createCustomerIndexShiftChecklist, createCustomerIndexIncidentDeck } from './operations-customer-index.mjs';
import { createCustomerIndexReportCards, createCustomerIndexReviewPackets, summarizeCustomerIndexReporting } from './reporting-customer-index.mjs';
import { createCustomerIndexAuditTrail, createCustomerIndexEvidenceManifest, createCustomerIndexReadinessAttestation } from './audit-customer-index.mjs';
import { createCustomerIndexPlaybooks, createCustomerIndexDecisionDeck, createCustomerIndexEscalationMoments } from './playbooks-customer-index.mjs';

export function buildCustomerIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerIndexWorkspace(workspaceName);
  const policies = createCustomerIndexPolicies();
  return {
    workspace,
    summary: summarizeCustomerIndexWorkspace(workspace),
    narratives: createCustomerIndexNarratives(workspace),
    coverage: createCustomerIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerIndexPolicies(policies),
    validation: validateCustomerIndexPolicies(policies),
    escalationDeck: createCustomerIndexEscalationDeck(policies),
    analytics: {
      timeline: createCustomerIndexAnalyticsTimeline(),
      forecast: createCustomerIndexForecastEnvelope(),
      exceptions: createCustomerIndexExceptionLedger(),
      summary: summarizeCustomerIndexAnalytics()
    },
    operations: {
      board: createCustomerIndexOperationsBoard(),
      checklist: createCustomerIndexShiftChecklist(),
      incidents: createCustomerIndexIncidentDeck()
    },
    reporting: {
      cards: createCustomerIndexReportCards(),
      packets: createCustomerIndexReviewPackets(),
      summary: summarizeCustomerIndexReporting()
    },
    audit: {
      trail: createCustomerIndexAuditTrail(),
      manifest: createCustomerIndexEvidenceManifest(),
      attestation: createCustomerIndexReadinessAttestation()
    },
    playbooks: createCustomerIndexPlaybooks(),
    decisions: createCustomerIndexDecisionDeck(),
    escalationMoments: createCustomerIndexEscalationMoments()
  };
}

export function createCustomerIndexReadinessBoard(snapshot = buildCustomerIndexSnapshot()) {
  return [
    { id: 'customer-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerIndexApiDocument(snapshot = buildCustomerIndexSnapshot()) {
  return {
    id: 'customer-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-index/overview' },
      { method: 'GET', path: '/api/customer-index/reporting' },
      { method: 'POST', path: '/api/customer-index/validate' },
      { method: 'GET', path: '/api/customer-index/audit' }
    ],
    readiness: createCustomerIndexReadinessBoard(snapshot)
  };
}

export function createCustomerIndexRouteSummary(snapshot = buildCustomerIndexSnapshot()) {
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

