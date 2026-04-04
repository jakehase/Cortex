import { createCommerceHubWorkspace, summarizeCommerceHubWorkspace, createCommerceHubNarratives, createCommerceHubCoverageGrid } from './domain-commerce-hub.mjs';
import { createCommerceHubPolicies, validateCommerceHubPolicies, summarizeCommerceHubPolicies, createCommerceHubEscalationDeck } from './policies-commerce-hub.mjs';
import { createCommerceHubAnalyticsTimeline, createCommerceHubForecastEnvelope, createCommerceHubExceptionLedger, summarizeCommerceHubAnalytics } from './analytics-commerce-hub.mjs';
import { createCommerceHubOperationsBoard, createCommerceHubShiftChecklist, createCommerceHubIncidentDeck } from './operations-commerce-hub.mjs';
import { createCommerceHubReportCards, createCommerceHubReviewPackets, summarizeCommerceHubReporting } from './reporting-commerce-hub.mjs';
import { createCommerceHubAuditTrail, createCommerceHubEvidenceManifest, createCommerceHubReadinessAttestation } from './audit-commerce-hub.mjs';
import { createCommerceHubPlaybooks, createCommerceHubDecisionDeck, createCommerceHubEscalationMoments } from './playbooks-commerce-hub.mjs';

export function buildCommerceHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceHubWorkspace(workspaceName);
  const policies = createCommerceHubPolicies();
  return {
    workspace,
    summary: summarizeCommerceHubWorkspace(workspace),
    narratives: createCommerceHubNarratives(workspace),
    coverage: createCommerceHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceHubPolicies(policies),
    validation: validateCommerceHubPolicies(policies),
    escalationDeck: createCommerceHubEscalationDeck(policies),
    analytics: {
      timeline: createCommerceHubAnalyticsTimeline(),
      forecast: createCommerceHubForecastEnvelope(),
      exceptions: createCommerceHubExceptionLedger(),
      summary: summarizeCommerceHubAnalytics()
    },
    operations: {
      board: createCommerceHubOperationsBoard(),
      checklist: createCommerceHubShiftChecklist(),
      incidents: createCommerceHubIncidentDeck()
    },
    reporting: {
      cards: createCommerceHubReportCards(),
      packets: createCommerceHubReviewPackets(),
      summary: summarizeCommerceHubReporting()
    },
    audit: {
      trail: createCommerceHubAuditTrail(),
      manifest: createCommerceHubEvidenceManifest(),
      attestation: createCommerceHubReadinessAttestation()
    },
    playbooks: createCommerceHubPlaybooks(),
    decisions: createCommerceHubDecisionDeck(),
    escalationMoments: createCommerceHubEscalationMoments()
  };
}

export function createCommerceHubReadinessBoard(snapshot = buildCommerceHubSnapshot()) {
  return [
    { id: 'commerce-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceHubApiDocument(snapshot = buildCommerceHubSnapshot()) {
  return {
    id: 'commerce-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-hub/overview' },
      { method: 'GET', path: '/api/commerce-hub/reporting' },
      { method: 'POST', path: '/api/commerce-hub/validate' },
      { method: 'GET', path: '/api/commerce-hub/audit' }
    ],
    readiness: createCommerceHubReadinessBoard(snapshot)
  };
}

export function createCommerceHubRouteSummary(snapshot = buildCommerceHubSnapshot()) {
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

