import { createBillingHubWorkspace, summarizeBillingHubWorkspace, createBillingHubNarratives, createBillingHubCoverageGrid } from './domain-billing-hub.mjs';
import { createBillingHubPolicies, validateBillingHubPolicies, summarizeBillingHubPolicies, createBillingHubEscalationDeck } from './policies-billing-hub.mjs';
import { createBillingHubAnalyticsTimeline, createBillingHubForecastEnvelope, createBillingHubExceptionLedger, summarizeBillingHubAnalytics } from './analytics-billing-hub.mjs';
import { createBillingHubOperationsBoard, createBillingHubShiftChecklist, createBillingHubIncidentDeck } from './operations-billing-hub.mjs';
import { createBillingHubReportCards, createBillingHubReviewPackets, summarizeBillingHubReporting } from './reporting-billing-hub.mjs';
import { createBillingHubAuditTrail, createBillingHubEvidenceManifest, createBillingHubReadinessAttestation } from './audit-billing-hub.mjs';
import { createBillingHubPlaybooks, createBillingHubDecisionDeck, createBillingHubEscalationMoments } from './playbooks-billing-hub.mjs';

export function buildBillingHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingHubWorkspace(workspaceName);
  const policies = createBillingHubPolicies();
  return {
    workspace,
    summary: summarizeBillingHubWorkspace(workspace),
    narratives: createBillingHubNarratives(workspace),
    coverage: createBillingHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingHubPolicies(policies),
    validation: validateBillingHubPolicies(policies),
    escalationDeck: createBillingHubEscalationDeck(policies),
    analytics: {
      timeline: createBillingHubAnalyticsTimeline(),
      forecast: createBillingHubForecastEnvelope(),
      exceptions: createBillingHubExceptionLedger(),
      summary: summarizeBillingHubAnalytics()
    },
    operations: {
      board: createBillingHubOperationsBoard(),
      checklist: createBillingHubShiftChecklist(),
      incidents: createBillingHubIncidentDeck()
    },
    reporting: {
      cards: createBillingHubReportCards(),
      packets: createBillingHubReviewPackets(),
      summary: summarizeBillingHubReporting()
    },
    audit: {
      trail: createBillingHubAuditTrail(),
      manifest: createBillingHubEvidenceManifest(),
      attestation: createBillingHubReadinessAttestation()
    },
    playbooks: createBillingHubPlaybooks(),
    decisions: createBillingHubDecisionDeck(),
    escalationMoments: createBillingHubEscalationMoments()
  };
}

export function createBillingHubReadinessBoard(snapshot = buildBillingHubSnapshot()) {
  return [
    { id: 'billing-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingHubApiDocument(snapshot = buildBillingHubSnapshot()) {
  return {
    id: 'billing-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-hub/overview' },
      { method: 'GET', path: '/api/billing-hub/reporting' },
      { method: 'POST', path: '/api/billing-hub/validate' },
      { method: 'GET', path: '/api/billing-hub/audit' }
    ],
    readiness: createBillingHubReadinessBoard(snapshot)
  };
}

export function createBillingHubRouteSummary(snapshot = buildBillingHubSnapshot()) {
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

