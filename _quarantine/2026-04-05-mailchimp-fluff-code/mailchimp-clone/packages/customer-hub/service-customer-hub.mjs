import { createCustomerHubWorkspace, summarizeCustomerHubWorkspace, createCustomerHubNarratives, createCustomerHubCoverageGrid } from './domain-customer-hub.mjs';
import { createCustomerHubPolicies, validateCustomerHubPolicies, summarizeCustomerHubPolicies, createCustomerHubEscalationDeck } from './policies-customer-hub.mjs';
import { createCustomerHubAnalyticsTimeline, createCustomerHubForecastEnvelope, createCustomerHubExceptionLedger, summarizeCustomerHubAnalytics } from './analytics-customer-hub.mjs';
import { createCustomerHubOperationsBoard, createCustomerHubShiftChecklist, createCustomerHubIncidentDeck } from './operations-customer-hub.mjs';
import { createCustomerHubReportCards, createCustomerHubReviewPackets, summarizeCustomerHubReporting } from './reporting-customer-hub.mjs';
import { createCustomerHubAuditTrail, createCustomerHubEvidenceManifest, createCustomerHubReadinessAttestation } from './audit-customer-hub.mjs';
import { createCustomerHubPlaybooks, createCustomerHubDecisionDeck, createCustomerHubEscalationMoments } from './playbooks-customer-hub.mjs';

export function buildCustomerHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerHubWorkspace(workspaceName);
  const policies = createCustomerHubPolicies();
  return {
    workspace,
    summary: summarizeCustomerHubWorkspace(workspace),
    narratives: createCustomerHubNarratives(workspace),
    coverage: createCustomerHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerHubPolicies(policies),
    validation: validateCustomerHubPolicies(policies),
    escalationDeck: createCustomerHubEscalationDeck(policies),
    analytics: {
      timeline: createCustomerHubAnalyticsTimeline(),
      forecast: createCustomerHubForecastEnvelope(),
      exceptions: createCustomerHubExceptionLedger(),
      summary: summarizeCustomerHubAnalytics()
    },
    operations: {
      board: createCustomerHubOperationsBoard(),
      checklist: createCustomerHubShiftChecklist(),
      incidents: createCustomerHubIncidentDeck()
    },
    reporting: {
      cards: createCustomerHubReportCards(),
      packets: createCustomerHubReviewPackets(),
      summary: summarizeCustomerHubReporting()
    },
    audit: {
      trail: createCustomerHubAuditTrail(),
      manifest: createCustomerHubEvidenceManifest(),
      attestation: createCustomerHubReadinessAttestation()
    },
    playbooks: createCustomerHubPlaybooks(),
    decisions: createCustomerHubDecisionDeck(),
    escalationMoments: createCustomerHubEscalationMoments()
  };
}

export function createCustomerHubReadinessBoard(snapshot = buildCustomerHubSnapshot()) {
  return [
    { id: 'customer-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerHubApiDocument(snapshot = buildCustomerHubSnapshot()) {
  return {
    id: 'customer-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-hub/overview' },
      { method: 'GET', path: '/api/customer-hub/reporting' },
      { method: 'POST', path: '/api/customer-hub/validate' },
      { method: 'GET', path: '/api/customer-hub/audit' }
    ],
    readiness: createCustomerHubReadinessBoard(snapshot)
  };
}

export function createCustomerHubRouteSummary(snapshot = buildCustomerHubSnapshot()) {
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

