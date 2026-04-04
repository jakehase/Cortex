import { createEcommerceHubWorkspace, summarizeEcommerceHubWorkspace, createEcommerceHubNarratives, createEcommerceHubCoverageGrid } from './domain-ecommerce-hub.mjs';
import { createEcommerceHubPolicies, validateEcommerceHubPolicies, summarizeEcommerceHubPolicies, createEcommerceHubEscalationDeck } from './policies-ecommerce-hub.mjs';
import { createEcommerceHubAnalyticsTimeline, createEcommerceHubForecastEnvelope, createEcommerceHubExceptionLedger, summarizeEcommerceHubAnalytics } from './analytics-ecommerce-hub.mjs';
import { createEcommerceHubOperationsBoard, createEcommerceHubShiftChecklist, createEcommerceHubIncidentDeck } from './operations-ecommerce-hub.mjs';
import { createEcommerceHubReportCards, createEcommerceHubReviewPackets, summarizeEcommerceHubReporting } from './reporting-ecommerce-hub.mjs';
import { createEcommerceHubAuditTrail, createEcommerceHubEvidenceManifest, createEcommerceHubReadinessAttestation } from './audit-ecommerce-hub.mjs';
import { createEcommerceHubPlaybooks, createEcommerceHubDecisionDeck, createEcommerceHubEscalationMoments } from './playbooks-ecommerce-hub.mjs';

export function buildEcommerceHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceHubWorkspace(workspaceName);
  const policies = createEcommerceHubPolicies();
  return {
    workspace,
    summary: summarizeEcommerceHubWorkspace(workspace),
    narratives: createEcommerceHubNarratives(workspace),
    coverage: createEcommerceHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceHubPolicies(policies),
    validation: validateEcommerceHubPolicies(policies),
    escalationDeck: createEcommerceHubEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceHubAnalyticsTimeline(),
      forecast: createEcommerceHubForecastEnvelope(),
      exceptions: createEcommerceHubExceptionLedger(),
      summary: summarizeEcommerceHubAnalytics()
    },
    operations: {
      board: createEcommerceHubOperationsBoard(),
      checklist: createEcommerceHubShiftChecklist(),
      incidents: createEcommerceHubIncidentDeck()
    },
    reporting: {
      cards: createEcommerceHubReportCards(),
      packets: createEcommerceHubReviewPackets(),
      summary: summarizeEcommerceHubReporting()
    },
    audit: {
      trail: createEcommerceHubAuditTrail(),
      manifest: createEcommerceHubEvidenceManifest(),
      attestation: createEcommerceHubReadinessAttestation()
    },
    playbooks: createEcommerceHubPlaybooks(),
    decisions: createEcommerceHubDecisionDeck(),
    escalationMoments: createEcommerceHubEscalationMoments()
  };
}

export function createEcommerceHubReadinessBoard(snapshot = buildEcommerceHubSnapshot()) {
  return [
    { id: 'ecommerce-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceHubApiDocument(snapshot = buildEcommerceHubSnapshot()) {
  return {
    id: 'ecommerce-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-hub/overview' },
      { method: 'GET', path: '/api/ecommerce-hub/reporting' },
      { method: 'POST', path: '/api/ecommerce-hub/validate' },
      { method: 'GET', path: '/api/ecommerce-hub/audit' }
    ],
    readiness: createEcommerceHubReadinessBoard(snapshot)
  };
}

export function createEcommerceHubRouteSummary(snapshot = buildEcommerceHubSnapshot()) {
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

